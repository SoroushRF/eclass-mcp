import fs from 'fs';
import {
  deriveEclassAccountScope,
  getActiveEclassAccountScope,
  setActiveEclassAccountScope,
} from '../cache/account-scope';
import { cache } from '../cache/store';
import { getLogger } from '../logging/context';
import { getEclassApiConfig } from '../scraper/eclass/api/constants';
import { MoodleRestClient } from '../scraper/eclass/api/rest';
import { closeAllEclassApiSessionContexts } from '../scraper/eclass/api/session-context';
import {
  FetchMoodleRestTransport,
  readCappedBody,
  type FetchLike,
} from '../scraper/eclass/api/transport';
import {
  advanceAuthGeneration,
  getSessionFilePath,
  saveMobileCredential,
  saveSession,
  type MobileCredential,
} from '../scraper/session';

/**
 * Optional QR login (ADR 0012): the account owner pastes the payload of the
 * QR code shown on their own eClass profile, and this exchanges it once for
 * a mobile token via `tool_mobile_get_tokens_for_qr_login` (findings F6–F8).
 * Off unless `ECLASS_MCP_ENABLE_QR_LOGIN=1`.
 */
export const QR_LOGIN_ENV_FLAG = 'ECLASS_MCP_ENABLE_QR_LOGIN';
export const QR_LOGIN_FUNCTION = 'tool_mobile_get_tokens_for_qr_login';
const QR_LOGIN_PATH = '/lib/ajax/service-nologin.php';
/** Moodle's `is_moodle_app()` checks for this user-agent token. */
export const MOODLE_MOBILE_USER_AGENT = 'MoodleMobile';
const MAX_QR_RESPONSE_BYTES = 64 * 1024;
const QR_KEY_PATTERN = /^[A-Za-z0-9]{8,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9]{16,128}$/;

export function isQrLoginEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[QR_LOGIN_ENV_FLAG] === '1';
}

export interface QrLoginPayload {
  origin: string;
  qrLoginKey: string;
  userId: number;
}

export type QrLoginErrorCode =
  | 'invalid_payload'
  | 'wrong_site'
  | 'qr_login_disabled'
  | 'app_required'
  | 'expired_or_used'
  | 'admin_not_allowed'
  | 'service_unavailable'
  | 'identity_mismatch'
  | 'upstream';

const QR_LOGIN_MESSAGES: Record<QrLoginErrorCode, string> = {
  invalid_payload:
    'That is not an eClass QR login code. Copy the text of the QR code shown under your eClass profile.',
  wrong_site: 'That QR code is for a different site than this server uses.',
  qr_login_disabled:
    'eClass does not allow QR login (the site QR code type is not "login"). Use /auth instead.',
  app_required:
    'eClass rejected the request as not coming from the Moodle app. Use /auth instead.',
  expired_or_used:
    'The QR code expired, was already used, or was generated on a different network. Generate a new one and try again within 10 minutes.',
  admin_not_allowed: 'Moodle does not allow QR login for administrators.',
  service_unavailable:
    'The site administrator has disabled mobile services. Use /auth instead.',
  identity_mismatch:
    'eClass returned a token for a different account than the QR code named. Nothing was saved.',
  upstream: 'eClass did not complete the QR login. Try again or use /auth.',
};

export class QrLoginError extends Error {
  readonly code: QrLoginErrorCode;

  constructor(code: QrLoginErrorCode) {
    super(QR_LOGIN_MESSAGES[code]);
    this.name = 'QrLoginError';
    this.code = code;
  }
}

/**
 * Parses `moodlemobile://https://<site>?qrlogin=<key>&userid=<id>`, or the
 * same `https://` URL without the app scheme (what a QR reader shows after
 * stripping it). No other outer scheme is accepted. The site must be the
 * configured origin over HTTPS, the key 8–128 letters or digits, and the
 * user id a positive integer.
 */
export function parseQrLoginPayload(
  raw: string,
  expectedOrigin: string = getEclassApiConfig().origin
): QrLoginPayload {
  const trimmed = raw.trim();
  const withoutScheme = trimmed.replace(
    /^moodlemobile:\/\/(?=https:\/\/)/i,
    ''
  );
  let url: URL;
  try {
    url = new URL(withoutScheme);
  } catch {
    throw new QrLoginError('invalid_payload');
  }
  const qrLoginKey = url.searchParams.get('qrlogin') ?? '';
  const userId = Number(url.searchParams.get('userid'));
  if (
    !QR_KEY_PATTERN.test(qrLoginKey) ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    throw new QrLoginError('invalid_payload');
  }
  const expected = new URL(expectedOrigin);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.origin !== expected.origin
  ) {
    throw new QrLoginError('wrong_site');
  }
  return { origin: url.origin, qrLoginKey, userId };
}

function mapQrErrorCode(errorCode: string | undefined): QrLoginErrorCode {
  switch (errorCode?.toLowerCase()) {
    case 'qrcodedisabled':
      return 'qr_login_disabled';
    case 'apprequired':
      return 'app_required';
    case 'invalidkey':
    case 'expiredkey':
    case 'invalidkeyip':
    case 'ipmismatch':
      return 'expired_or_used';
    case 'autologinnotallowedtoadmins':
      return 'admin_not_allowed';
    case 'servicenotavailable':
    case 'enablewsdescription':
    case 'webservicesnotenabled':
    case 'mobilefeaturesnotenabled':
      return 'service_unavailable';
    default:
      return 'upstream';
  }
}

function errorCodeOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.errorcode === 'string') return record.errorcode;
  if (record.exception && typeof record.exception === 'object') {
    const code = (record.exception as Record<string, unknown>).errorcode;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export interface ExchangeQrLoginOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
}

/**
 * Exchanges a parsed QR payload for a mobile credential. The key and the
 * returned tokens are never logged; only the outcome code is.
 */
export async function exchangeQrLogin(
  payload: QrLoginPayload,
  options: ExchangeQrLoginOptions = {}
): Promise<MobileCredential> {
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const endpoint = new URL(QR_LOGIN_PATH, payload.origin);
  endpoint.searchParams.set('info', QR_LOGIN_FUNCTION);
  let outcome: QrLoginErrorCode | 'ok' = 'upstream';

  try {
    let response: Response;
    try {
      response = await fetchImpl(endpoint.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': MOODLE_MOBILE_USER_AGENT,
        },
        body: JSON.stringify([
          {
            index: 0,
            methodname: QR_LOGIN_FUNCTION,
            args: { qrloginkey: payload.qrLoginKey, userid: payload.userId },
          },
        ]),
        redirect: 'error',
        signal: AbortSignal.timeout(
          options.timeoutMs ?? getEclassApiConfig().timeoutMs
        ),
      });
    } catch {
      throw new QrLoginError('upstream');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new QrLoginError('upstream');
    }

    let parsed: unknown;
    try {
      const body = await readCappedBody(response, MAX_QR_RESPONSE_BYTES);
      parsed = JSON.parse(body.toString('utf8')) as unknown;
    } catch {
      throw new QrLoginError('upstream');
    }

    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const record =
      first && typeof first === 'object'
        ? (first as Record<string, unknown>)
        : {};
    if (record.error || !Array.isArray(parsed)) {
      throw new QrLoginError(mapQrErrorCode(errorCodeOf(record)));
    }
    const data =
      record.data && typeof record.data === 'object'
        ? (record.data as Record<string, unknown>)
        : {};
    const token = typeof data.token === 'string' ? data.token : '';
    const privateToken =
      typeof data.privatetoken === 'string' ? data.privatetoken : '';
    if (!TOKEN_PATTERN.test(token)) {
      throw new QrLoginError('upstream');
    }

    outcome = 'ok';
    return {
      service: 'moodle_mobile_app',
      token,
      ...(TOKEN_PATTERN.test(privateToken) ? { privateToken } : {}),
      issuedAt: (options.now?.() ?? new Date()).toISOString(),
    };
  } catch (error) {
    if (error instanceof QrLoginError) outcome = error.code;
    throw error;
  } finally {
    getLogger().info(
      { event: 'qr_login_exchange', outcome },
      'eClass QR login exchange completed'
    );
  }
}

export interface VerifyQrCredentialOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Reads site info with the new token alone (held in memory, nothing saved)
 * and requires the account to be the one the QR code named.
 */
export async function verifyQrCredential(
  credential: MobileCredential,
  payload: QrLoginPayload,
  options: VerifyQrCredentialOptions = {}
): Promise<void> {
  const client = new MoodleRestClient({
    transport: new FetchMoodleRestTransport({
      origin: payload.origin,
      timeoutMs: options.timeoutMs ?? getEclassApiConfig().timeoutMs,
      fetchImpl: options.fetchImpl,
    }),
    credentialReader: { load: () => credential, clear: () => undefined },
  });
  let userId: string;
  try {
    userId = await client.getVerifiedUserId();
  } catch {
    throw new QrLoginError('upstream');
  }
  if (userId !== String(payload.userId)) {
    throw new QrLoginError('identity_mismatch');
  }
}

export type QrAccountTransition = 'same_account' | 'replaced_account';

/**
 * Stores a verified QR credential. Cookies are kept only when the active
 * account scope already belongs to the same user; otherwise the whole
 * envelope is replaced, API contexts are closed, the previous account's
 * caches are cleared, and the scope moves to the QR account. Either way
 * the auth generation advances, so an in-flight renewal cannot overwrite it.
 */
export async function applyQrCredential(
  credential: MobileCredential,
  payload: QrLoginPayload
): Promise<QrAccountTransition> {
  const nextScope = deriveEclassAccountScope(payload.origin, payload.userId);
  const previousScope = getActiveEclassAccountScope();
  if (previousScope === nextScope && fs.existsSync(getSessionFilePath())) {
    advanceAuthGeneration();
    saveMobileCredential(credential);
    return 'same_account';
  }

  await closeAllEclassApiSessionContexts();
  saveSession([], 'session.json', credential);
  if (previousScope) cache.clearEclassAccountScope(previousScope);
  cache.clearVolatile();
  setActiveEclassAccountScope(payload.origin, payload.userId);
  return 'replaced_account';
}

/** Exchange, verify, then store: nothing is saved unless every step passes. */
export async function completeQrLogin(
  payload: QrLoginPayload,
  options: ExchangeQrLoginOptions = {}
): Promise<QrAccountTransition> {
  const credential = await exchangeQrLogin(payload, options);
  await verifyQrCredential(credential, payload, options);
  const transition = await applyQrCredential(credential, payload);
  getLogger().info(
    { event: 'qr_login_applied', transition },
    'eClass QR login credential stored'
  );
  return transition;
}
