import type { BrowserContext } from 'playwright';
import { getLogger } from '../logging/context';
import { serializeApiErrorForLog } from '../logging/api-safe';
import {
  getEclassApiConfig,
  type EclassSourceMode,
} from '../scraper/eclass/api/constants';
import { MoodleMobileLauncher } from '../scraper/eclass/api/mobile';
import { EclassApiSessionContext } from '../scraper/eclass/api/session-context';
import type { MobileCredential } from '../scraper/session';

export interface MintAfterLoginOptions {
  /** The still-open, freshly authenticated login browser context. */
  context: BrowserContext;
  origin?: string;
  timeoutMs?: number;
  /** Defaults to `ECLASS_API_SOURCE_MODE`. */
  sourceMode?: EclassSourceMode;
  /** Test seam; defaults to the real `launch.php` handshake. */
  createLauncher?: (sessionContext: EclassApiSessionContext) => {
    launch(): Promise<MobileCredential>;
  };
}

export interface MintAfterLoginOutcome {
  minted: boolean;
  privateToken: boolean;
  errorCode?: string;
}

/**
 * Best-effort mobile token mint right after a visible eClass login (ADR 0011).
 * A fresh login is the only time Moodle issues a private token. Failure never
 * fails the login: cookies are already saved and Playwright/AJAX still work.
 * Only the outcome shape is logged, never token material. In `playwright`
 * mode (the default and the kill switch) nothing is minted.
 */
export async function mintMobileTokenAfterLogin(
  options: MintAfterLoginOptions
): Promise<MintAfterLoginOutcome> {
  const config = getEclassApiConfig();
  if ((options.sourceMode ?? config.sourceMode) === 'playwright') {
    return { minted: false, privateToken: false, errorCode: 'disabled' };
  }
  const origin = options.origin ?? config.origin;
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const sessionContext = new EclassApiSessionContext({
    browserSession: { getAuthenticatedContext: async () => options.context },
    origin,
    timeoutMs,
  });
  const launcher =
    options.createLauncher?.(sessionContext) ??
    new MoodleMobileLauncher({ sessionContext, origin, timeoutMs });

  let outcome: MintAfterLoginOutcome;
  try {
    const credential = await launcher.launch();
    outcome = { minted: true, privateToken: Boolean(credential.privateToken) };
    getLogger().info(
      { event: 'mobile_token_minted', privateToken: outcome.privateToken },
      'Moodle mobile token minted after login'
    );
  } catch (error) {
    const safeError = serializeApiErrorForLog(error);
    outcome = {
      minted: false,
      privateToken: false,
      errorCode: safeError.errorCode || 'mint_failed',
    };
    getLogger().warn(
      { event: 'mobile_token_mint_failed', errorCode: outcome.errorCode },
      'Moodle mobile token mint after login failed; continuing with cookies'
    );
  } finally {
    await sessionContext.close();
  }
  return outcome;
}
