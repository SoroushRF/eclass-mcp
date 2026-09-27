/**
 * Account-owner probe for the Moodle mobile token path (ADR 0011, Phase 2).
 *
 * Usage (after logging in through the MCP /auth flow):
 *   npm run probe:mobile                  # mint a token, then verify it
 *   npm run probe:mobile -- --verify-only # verify the stored token only
 *
 * Verification reads site info over the production cookie-free fetch
 * transport. The run passes (exit 0) only with a positive user id and a
 * non-empty function list; neither the id nor the token is printed.
 *
 * Prints only shapes (yes/no, lengths, release/version, function count and
 * routing presence). The full sorted function-name list is written to
 * .eclass-mcp/debug/mobile-functions.json, which is gitignored.
 *
 * Minting stores the token in the encrypted session envelope, exactly as the
 * server would. Never paste this command's environment or the session file
 * anywhere.
 */
import { EClassBrowserSession } from '../src/scraper/eclass/browser-session';
import { getEclassApiConfig } from '../src/scraper/eclass/api/constants';
import { EclassApiSessionContext } from '../src/scraper/eclass/api/session-context';
import { MoodleMobileLauncher } from '../src/scraper/eclass/api/mobile';
import {
  createCookieFreeSiteInfoReader,
  formatMobileProbeReport,
  mobileProbePassed,
  runMobileProbe,
  writeMobileFunctionList,
} from '../src/scraper/eclass/api/mobile-probe';
import {
  getSessionFilePath,
  loadMobileCredential,
} from '../src/scraper/session';

async function main(): Promise<number> {
  const config = getEclassApiConfig();
  const verifyOnly = process.argv.includes('--verify-only');
  const browserSession = new EClassBrowserSession();
  const sessionContext = new EclassApiSessionContext({
    browserSession,
    origin: config.origin,
    timeoutMs: config.timeoutMs,
  });

  try {
    const launcher = new MoodleMobileLauncher({
      sessionContext,
      origin: config.origin,
      timeoutMs: config.timeoutMs,
    });
    const { report, functionNames } = await runMobileProbe({
      launch: verifyOnly
        ? async () => {
            const stored = loadMobileCredential();
            if (!stored) throw new Error('NoStoredToken');
            return stored;
          }
        : () => launcher.launch(),
      credentialSource: verifyOnly ? 'stored' : 'minted',
      getSiteInfo: createCookieFreeSiteInfoReader({
        origin: config.origin,
        timeoutMs: config.timeoutMs,
      }),
    });

    console.log(formatMobileProbeReport(report));
    if (functionNames.length > 0) {
      const outFile = getSessionFilePath('debug/mobile-functions.json');
      writeMobileFunctionList(outFile, functionNames);
      console.log(`function list written to ${outFile} (gitignored)`);
    }
    return mobileProbePassed(report) ? 0 : 1;
  } catch (error) {
    // The session bootstrap throws when no fresh cookie session exists.
    console.error(
      `probe failed before minting: ${error instanceof Error ? error.name : 'unknown'}. ` +
        'Log in through the MCP /auth flow first, then re-run.'
    );
    return 1;
  } finally {
    await sessionContext.close().catch(() => undefined);
    await browserSession.close().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  () => process.exit(1)
);
