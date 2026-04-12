import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function main() {
  // __dirname is scripts/
  const statePath = path.resolve(
    __dirname,
    '../.eclass-mcp/cengage-state.json'
  );

  if (!fs.existsSync(statePath)) {
    console.error(
      'No Cengage session state found. Please run "npm run auth:cengage" first.'
    );
    process.exit(1);
  }

  console.log(
    'Got Cengage session state (Cookies + LocalStorage). Launching visible browser (to avoid Okta bot-blocking)...'
  );
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: statePath });

  const page = await context.newPage();

  console.log('Navigating to Cengage Dashboard...');
  // By visiting the login page, the auth cookies should automatically trigger a redirect
  // straight into the authenticated dashboard/webassign interface.
  await page.goto('https://login.cengage.com/', {
    waitUntil: 'load',
    timeout: 30000,
  });

  console.log('Waiting for authentication redirect to settle...');
  try {
    await page.waitForURL(/(.*dashboard.*|.*webassign\.net.*)/i, {
      timeout: 30000,
    });
  } catch (e) {
    console.log(
      'Warning: Did not completely reach the expected dashboard URL, but will try to dump anyway...'
    );
  }

  console.log(
    'Waiting 8 seconds for React/Angular components to finish rendering assignments...'
  );
  await page.waitForTimeout(8000);

  console.log('Final URL reached:', page.url());

  const dumpPath = path.resolve(
    __dirname,
    '../.eclass-mcp/cengage-dashboard.html'
  );
  const dir = path.dirname(dumpPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const html = await page.content();
  fs.writeFileSync(dumpPath, html, 'utf-8');

  console.log(
    `\nSuccessfully dumped Cengage Dashboard HTML to: \n  ${dumpPath}`
  );
  console.log(
    'The AI agent will read this file directly to figure out the CSS selectors!'
  );

  await browser.close();
}

main().catch(console.error);
