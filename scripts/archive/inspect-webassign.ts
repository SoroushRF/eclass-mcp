import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function main() {
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

  console.log('Got Cengage session state. Launching visible browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  console.log(
    'Navigating directly to your MATH 1014 WebAssign via the SSO link...'
  );
  await page.goto(
    'https://www.webassign.net/v4cgi/login.pl?pid=571417&eISBN=9780357128992&courseKey=WA-production-1607530',
    { waitUntil: 'load', timeout: 30000 }
  );

  console.log('Waiting for authentication redirect to settle...');
  try {
    await page.waitForURL(
      /(.*webassign\.net\/web\/Student.*|.*webassign\.net\/v4cgi\/student.*)/i,
      { timeout: 30000 }
    );
  } catch (e) {
    console.log(
      'Warning: Did not completely reach the expected WebAssign dashboard URL.'
    );
  }

  console.log('Looking for "Past Assignments" button...');
  try {
    // WebAssign past assignments button often has id or specific text
    await page.waitForSelector('button:has-text("Past Assignments")', {
      timeout: 10000,
    });
    await page.click('button:has-text("Past Assignments")');
    console.log('Clicked "Past Assignments" button');
  } catch (e) {
    console.log(
      'Could not find "Past Assignments" button using text selector. Trying alternatives...'
    );
    try {
      await page.click('.css-q10f9y button'); // Common WebAssign button class from dump
      console.log('Clicked a button in the assignments section.');
    } catch (e2) {
      console.log('Could not click past assignments.');
    }
  }

  console.log('Waiting 10 seconds for data to load...');
  await page.waitForTimeout(10000);

  console.log('Final URL reached:', page.url());

  const screenshotPath = path.resolve(
    __dirname,
    '../.eclass-mcp/webassign-screenshot.png'
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);

  const dumpPath = path.resolve(
    __dirname,
    '../.eclass-mcp/webassign-dashboard.html'
  );
  const dir = path.dirname(dumpPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const html = await page.content();
  fs.writeFileSync(dumpPath, html, 'utf-8');

  console.log(
    `\nSuccessfully dumped WebAssign Dashboard HTML to: \n  ${dumpPath}`
  );

  await browser.close();
}

main().catch(console.error);
