import { chromium } from 'playwright';
import { loadSession } from '../src/scraper/session';

async function main() {
  const ltiUrl = process.argv[2];
  if (!ltiUrl || !ltiUrl.includes('lti')) {
    console.error('Usage: npx ts-node scripts/inspect-cengage-auth.ts <LTI_URL>');
    console.error('Example: npx ts-node scripts/inspect-cengage-auth.ts https://eclass.yorku.ca/mod/lti/view.php?id=123456');
    process.exit(1);
  }

  console.log(`Starting inspector for LTI Link: ${ltiUrl}`);

  const sessionData = loadSession();

  if (!sessionData) {
    console.error('No eClass session found. Please run your normal MCP auth flow first to log into eClass.');
    process.exit(1);
  }

  console.log('Got eClass session cookies. Launching visible browser...');

  const browser = await chromium.launch({ headless: false });
  // Granting permissions in case LTI tries to open popups
  const context = await browser.newContext();
  await context.addCookies(sessionData);

  const page = await context.newPage();

  console.log(`Navigating to ${ltiUrl}...`);
  try {
    await page.goto(ltiUrl, { waitUntil: 'load', timeout: 30000 });
  } catch (e) {
    console.log(`Navigation hit timeout or error. Continuing...`);
  }

  console.log('LTI page loaded. Waiting 5 seconds for any auto-submit forms...');
  await page.waitForTimeout(5000);

  console.log('------------------------------------------------');
  console.log('🚨 ACTION REQUIRED 🚨');
  console.log('Please look at the browser window just opened.');
  console.log('1. If the WebAssign/Cengage dashboard is already visible, do nothing.');
  console.log('2. If eClass left you on a page with a "Launch Tool" or "Open in new window" button, CLICK IT manually.');
  console.log('');
  console.log('Waiting 30 seconds for you to get the WebAssign dashboard fully loaded...');
  console.log('------------------------------------------------');
  
  await page.waitForTimeout(30000);

  // If a new tab was opened by a popup button, grab it
  const pages = context.pages();
  const cengagePage = pages[pages.length - 1]; // Use the most recently opened tab

  console.log('\n--- Collecting Auth Information ---');
  const finalUrl = cengagePage.url();
  console.log(`Final URL reached: ${finalUrl}`);

  const cookies = await context.cookies();
  const cengageCookies = cookies.filter(c => 
    c.domain.includes('cengage') || 
    c.domain.includes('webassign') || 
    c.domain.includes('mindtap')
  );

  console.log(`Total session cookies: ${cookies.length}`);
  console.log(`Cengage/WebAssign-related cookies: ${cengageCookies.length}`);
  
  if (cengageCookies.length > 0) {
    const uniqueDomains = Array.from(new Set(cengageCookies.map(c => c.domain)));
    console.log(`\nFound target cookies for domains: \n  ${uniqueDomains.join('\n  ')}`);
    
    // Dump for the user to paste back
    const cookieSummary = cengageCookies.map(c => ({ name: c.name, domain: c.domain }));
    console.table(cookieSummary);
  } else {
    console.log('\nWarning: No cookies found containing "cengage", "webassign", or "mindtap" in the domain.');
    console.log('Here are ALL domains that currently have cookies set:');
    const allDomains = Array.from(new Set(cookies.map(c => c.domain)));
    console.log(allDomains);
  }

  await browser.close();
  console.log('Inspection complete.');
}

main().catch(console.error);
