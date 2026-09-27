/**
 * Account-owner probe for the Moodle mobile token path (ADR 0011, Phase 2).
 *
 * Usage (after logging in through the MCP /auth flow):
 *   npm run probe:mobile
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
  formatMobileProbeReport,
  runMobileProbe,
  writeMobileFunctionList,
} from '../src/scraper/eclass/api/mobile-probe';
import {
  MOODLE_REST_CAPABILITIES,
  MoodleRestClient,
} from '../src/scraper/eclass/api/rest';
import { PlaywrightMoodleTransport } from '../src/scraper/eclass/api/transport';
import { getSessionFilePath } from '../src/scraper/session';

async function main(): Promise<number> {
  const config = getEclassApiConfig();
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
      launch: () => launcher.launch(),
      getSiteInfo: async () => {
        const session = await sessionContext.getSession();
        const client = new MoodleRestClient({
          transport: new PlaywrightMoodleTransport({
            request: session.request,
            origin: config.origin,
            timeoutMs: config.timeoutMs,
          }),
        });
        return client.callCapability(MOODLE_REST_CAPABILITIES.siteInfo);
      },
    });

    console.log(formatMobileProbeReport(report));
    if (functionNames.length > 0) {
      const outFile = getSessionFilePath('debug/mobile-functions.json');
      writeMobileFunctionList(outFile, functionNames);
      console.log(`function list written to ${outFile} (gitignored)`);
    }
    return report.minted && !report.restError ? 0 : 1;
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
