import { chromium } from 'playwright';
import {
  CENGAGE_STATE_PATH,
  ensureCengageSessionDir,
  saveCengageSessionMetadata,
} from '../scraper/cengage-session';
import { rootLogger } from '../logging/logger';

const log = rootLogger.child({ component: 'cengage-auth-cli' });

async function main() {
  log.info('Starting standalone Cengage authentication...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  log.info('Navigating to https://login.cengage.com/ ...');
  await page.goto('https://login.cengage.com/', { waitUntil: 'load' });

  log.info('------------------------------------------------');
  log.info('ACTION REQUIRED: complete login in the browser window');
  log.info(
    'Please log in to your Cengage/WebAssign account in the browser window.'
  );
  log.info(
    'This script will automatically detect when you reach the dashboard.'
  );
  log.info('Waiting up to 3 minutes for you to complete login...');
  log.info('------------------------------------------------');

  try {
    // Wait for the URL to change to the dashboard or webassign course page
    await page.waitForURL(/(.*dashboard.*|.*webassign\.net\/web\/Student.*)/i, {
      timeout: 180000,
    });
    log.info('Dashboard detected! Collecting session cookies...');
  } catch (_error) {
    // Let's just give a general timeout in case their url doesn't match the regex perfectly
    log.info(
      'Did not automatically detect dashboard URL. If you are logged in, the cookies will still be saved.'
    );
  }

  // To be safe, wait an extra 5 seconds after they seemingly reach the dashboard
  await page.waitForTimeout(5000);

  ensureCengageSessionDir(CENGAGE_STATE_PATH);
  await context.storageState({ path: CENGAGE_STATE_PATH });
  saveCengageSessionMetadata({ statePath: CENGAGE_STATE_PATH });
  log.info(
    'Saved Cengage session state and metadata to .eclass-mcp/cengage-state.json...'
  );

  log.info('Cengage authentication successful!');
  setTimeout(async () => {
    await browser.close();
  }, 2000);
}

main().catch((err) => {
  log.fatal({ err }, 'Cengage auth script failed');
  process.exit(1);
});
