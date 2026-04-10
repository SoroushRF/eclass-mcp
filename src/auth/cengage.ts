import { chromium } from 'playwright';
import {
  CENGAGE_STATE_PATH,
  ensureCengageSessionDir,
  saveCengageSessionMetadata,
} from '../scraper/cengage-session';

async function main() {
  console.log('Starting standalone Cengage authentication...');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to https://login.cengage.com/ ...');
  await page.goto('https://login.cengage.com/', { waitUntil: 'load' });

  console.log('------------------------------------------------');
  console.log('🚨 ACTION REQUIRED 🚨');
  console.log(
    'Please log in to your Cengage/WebAssign account in the browser window.'
  );
  console.log(
    'This script will automatically detect when you reach the dashboard.'
  );
  console.log('Waiting up to 3 minutes for you to complete login...');
  console.log('------------------------------------------------');

  try {
    // Wait for the URL to change to the dashboard or webassign course page
    await page.waitForURL(/(.*dashboard.*|.*webassign\.net\/web\/Student.*)/i, {
      timeout: 180000,
    });
    console.log('Dashboard detected! Collecting session cookies...');
  } catch (_error) {
    // Let's just give a general timeout in case their url doesn't match the regex perfectly
    console.log(
      'Did not automatically detect dashboard URL. If you are logged in, the cookies will still be saved.'
    );
  }

  // To be safe, wait an extra 5 seconds after they seemingly reach the dashboard
  await page.waitForTimeout(5000);

  ensureCengageSessionDir(CENGAGE_STATE_PATH);
  await context.storageState({ path: CENGAGE_STATE_PATH });
  saveCengageSessionMetadata({ statePath: CENGAGE_STATE_PATH });
  console.log(
    'Saved Cengage session state and metadata to .eclass-mcp/cengage-state.json...'
  );

  console.log('Cengage authentication successful!');
  setTimeout(async () => {
    await browser.close();
  }, 2000);
}

main().catch(console.error);
