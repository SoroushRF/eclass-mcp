import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { getLogger } from '../../../logging/context';
import { createSafeApiLogFields } from '../../../logging/api-safe';
import {
  ECLASS_DEFAULT_ORIGIN,
  ECLASS_MOBILE_LAUNCH_PATH,
  getEclassApiConfig,
} from './constants';
import { MoodleApiError } from './errors';
import type { EclassApiSessionContext } from './session-context';
import { saveMobileCredential, type MobileCredential } from '../../session';

/**
 * Moodle returns tokens as PARAM_ALPHANUM. Default Moodle tokens are 32 hex
 * characters and private tokens 64 alphanumerics; keep the bound loose until
 * the account-owner probe records York's shape (findings log, open question 5).
 */
const MOBILE_TOKEN_PATTERN = /^[A-Za-z0-9]{16,128}$/;
const ACCEPTED_MOBILE_SCHEMES = new Set(['moodlemobile', 'moodle']);
const LAUNCH_PAYLOAD_PREFIX = '://token=';
const STRICT_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MD5_HEX_PATTERN = /^[a-f0-9]{32}$/;

function normalizeOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new MoodleApiError({ category: 'upstream' });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new MoodleApiError({ category: 'upstream' });
  }
  return parsed.origin;
}

export interface MobileCredentialStore {
  save(credential: MobileCredential): void;
}

export interface MoodleMobileLauncherOptions {
  sessionContext: Pick<EclassApiSessionContext, 'getSession'>;
  origin?: string;
  timeoutMs?: number;
  credentialStore?: MobileCredentialStore;
}

export function generateMobilePassport(): string {
  return randomBytes(32).toString('base64url');
}

export interface MobileLaunchBinding {
  /** Moodle `$CFG->wwwroot`, e.g. `https://eclass.yorku.ca` (no trailing slash). */
  origin: string;
  /** The one-time passport this process sent to `launch.php`. */
  passport: string;
}

export interface ParsedMobileLaunch {
  token: string;
  privateToken?: string;
}

function malformed(): MoodleApiError {
  return new MoodleApiError({ category: 'malformed_response' });
}

/** `md5($CFG->wwwroot . $passport)` exactly as `launch.php` computes it. */
export function computeMobileLaunchSiteId(
  origin: string,
  passport: string
): string {
  return createHash('md5')
    .update(origin.replace(/\/+$/, '') + passport, 'utf8')
    .digest('hex');
}

function decodeStrictBase64(value: string): string {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !STRICT_BASE64_PATTERN.test(value)
  ) {
    throw malformed();
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw malformed();
  }
  return decoded.toString('utf8');
}

function hexEquals(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'utf8');
  const actual = Buffer.from(actualHex.toLowerCase(), 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Parses the `launch.php` redirect target:
 * `<scheme>://token=<base64(md5(wwwroot . passport) ":::" token [":::" privatetoken])>`.
 *
 * The payload sits where a URL parser expects the host, so this deliberately
 * does not use `new URL()`. The md5 prefix binds the redirect to the passport
 * this process generated.
 */
export function parseMobileLaunchLocation(
  location: string,
  binding: MobileLaunchBinding
): ParsedMobileLaunch {
  const value = location.trim();
  const schemeEnd = value.indexOf(LAUNCH_PAYLOAD_PREFIX);
  if (schemeEnd <= 0) throw malformed();

  const scheme = value.slice(0, schemeEnd).toLowerCase();
  if (!ACCEPTED_MOBILE_SCHEMES.has(scheme)) throw malformed();

  let payload = value.slice(schemeEnd + LAUNCH_PAYLOAD_PREFIX.length);
  if (payload.includes('%')) {
    try {
      payload = decodeURIComponent(payload);
    } catch {
      throw malformed();
    }
  }

  const parts = decodeStrictBase64(payload).split(':::');
  if (parts.length !== 2 && parts.length !== 3) throw malformed();

  const [siteId, token, privateToken] = parts;
  if (!MD5_HEX_PATTERN.test(siteId.toLowerCase())) throw malformed();
  const expectedSiteId = computeMobileLaunchSiteId(
    binding.origin,
    binding.passport
  );
  if (!hexEquals(expectedSiteId, siteId)) throw malformed();

  if (!MOBILE_TOKEN_PATTERN.test(token)) throw malformed();
  if (privateToken !== undefined && !MOBILE_TOKEN_PATTERN.test(privateToken)) {
    throw malformed();
  }

  return privateToken === undefined ? { token } : { token, privateToken };
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * iOS user agents (and `confirmed=1`) get an HTML page whose `#launchapp`
 * anchor carries the same custom-scheme URL. Returns that href, or null.
 */
export function extractMobileLaunchAnchorHref(html: string): string | null {
  const anchors = html.match(/<a\b[^>]*>/gi) ?? [];
  for (const anchor of anchors) {
    if (!/\bid\s*=\s*["']launchapp["']/i.test(anchor)) continue;
    const href = anchor.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    return href ? decodeHtmlAttribute(href[2]) : null;
  }
  return null;
}

export class MoodleMobileLauncher {
  private readonly sessionContext: Pick<EclassApiSessionContext, 'getSession'>;
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly credentialStore: MobileCredentialStore;

  constructor(options: MoodleMobileLauncherOptions) {
    const config = getEclassApiConfig();
    this.sessionContext = options.sessionContext;
    this.origin = normalizeOrigin(
      options.origin ?? config.origin ?? ECLASS_DEFAULT_ORIGIN
    );
    this.timeoutMs = options.timeoutMs ?? config.timeoutMs;
    this.credentialStore = options.credentialStore ?? {
      save: (credential) => saveMobileCredential(credential),
    };
  }

  async launch(): Promise<MobileCredential> {
    const session = await this.sessionContext.getSession();
    const passport = generateMobilePassport();
    const endpoint = new URL(ECLASS_MOBILE_LAUNCH_PATH, this.origin);
    endpoint.searchParams.set('service', 'moodle_mobile_app');
    endpoint.searchParams.set('passport', passport);
    const startedAt = Date.now();
    let status: number | undefined;
    let tokenPresent = false;

    try {
      const response = await session.request.get(endpoint.toString(), {
        timeout: this.timeoutMs,
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      status = response.status();

      if (status === 401 || status === 403) {
        throw new MoodleApiError({
          category: 'session_invalid',
          status,
        });
      }

      let location: string | undefined;
      if (status >= 300 && status < 400) {
        location = response.headers().location;
      } else if (status === 200) {
        // Fallback for the iOS/confirmed HTML branch of launch.php.
        location =
          extractMobileLaunchAnchorHref(await response.text()) ?? undefined;
      } else {
        throw new MoodleApiError({
          category: 'upstream',
          status,
        });
      }
      if (!location) {
        throw new MoodleApiError({
          category: 'malformed_response',
          status,
        });
      }

      const parsed = parseMobileLaunchLocation(location, {
        origin: this.origin,
        passport,
      });
      tokenPresent = true;
      const credential: MobileCredential = {
        service: 'moodle_mobile_app',
        token: parsed.token,
        ...(parsed.privateToken ? { privateToken: parsed.privateToken } : {}),
        issuedAt: new Date().toISOString(),
      };
      this.credentialStore.save(credential);
      return credential;
    } catch (error) {
      if (error instanceof MoodleApiError) throw error;
      throw new MoodleApiError({
        category:
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timeout'
            : 'upstream',
        status,
        cause: error,
      });
    } finally {
      getLogger().info(
        createSafeApiLogFields({
          operation: 'mobile.launch',
          source: 'api',
          endpointPath: ECLASS_MOBILE_LAUNCH_PATH,
          ...(status !== undefined ? { status } : {}),
          durationMs: Date.now() - startedAt,
          tokenPresent,
        }),
        'Moodle mobile launch completed'
      );
    }
  }
}
