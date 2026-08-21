import { randomBytes } from 'crypto';
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

const MOBILE_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{16,4096}$/;
const ACCEPTED_MOBILE_SCHEMES = new Set(['moodlemobile:', 'moodle:']);

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

export function parseMobileLaunchLocation(location: string): string {
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    throw new MoodleApiError({ category: 'malformed_response' });
  }

  if (!ACCEPTED_MOBILE_SCHEMES.has(parsed.protocol)) {
    throw new MoodleApiError({ category: 'malformed_response' });
  }
  if (parsed.username || parsed.password) {
    throw new MoodleApiError({ category: 'malformed_response' });
  }
  const token = parsed.searchParams.get('token')?.trim() || '';
  if (!MOBILE_TOKEN_PATTERN.test(token)) {
    throw new MoodleApiError({ category: 'malformed_response' });
  }
  return token;
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
      if (status < 300 || status >= 400) {
        throw new MoodleApiError({
          category: 'upstream',
          status,
        });
      }

      const headers = response.headers();
      const location = headers.location;
      if (!location) {
        throw new MoodleApiError({
          category: 'malformed_response',
          status,
        });
      }
      const token = parseMobileLaunchLocation(location);
      tokenPresent = true;
      const credential: MobileCredential = {
        service: 'moodle_mobile_app',
        token,
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
