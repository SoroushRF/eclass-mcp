import { chromium } from 'playwright';
import { loadSession } from '../src/scraper/session';
import fs from 'fs';
import path from 'path';

async function discoverSelectors() {
  console.log('🔍 Running Selector Discovery Scan...');
  
  const browser = await chromium.launch({ headless: true });
  const cookiesList = loadSession();
  if (!cookiesList) {
    console.error('❌ NO SESSION FOUND. Please log in first.');
    await browser.close();
    return;
  }
  const context = await browser.newContext();
  await context.addCookies(cookiesList);
  const page = await context.newPage();

  try {
    await page.goto('https://eclass.yorku.ca/calendar/view.php?view=upcoming', { waitUntil: 'networkidle' });
    
    // Check if we were redirected to login
    if (page.url().includes('login')) {
      console.error('❌ SESSION EXPIRED. Please log in again.');
      return;
    }

    console.log(`📍 Successfully reached: ${page.url()}`);

    // DUMP THE WHOLE PAGE for my AI brain to inspect manually
    const html = await page.content();
    const debugPath = path.resolve(process.cwd(), '.eclass-mcp/debug/deadlines_discovery.html');
    if (!fs.existsSync(path.dirname(debugPath))) fs.mkdirSync(path.dirname(debugPath), { recursive: true });
    fs.writeFileSync(debugPath, html);
    console.log(`📂 HTML Dumped to: ${debugPath}`);

    // LOG TOP LEVEL HIERARCHY
    const structure = await page.evaluate(() => {
      const topLevelNames = Array.from(document.querySelectorAll('.calendar-upcoming .event, .card-body .event, [class*="event"]'));
      return topLevelNames.slice(0, 5).map(el => ({
        tag: el.tagName,
        classes: el.className,
        text: el.textContent?.trim().slice(0, 50)
      }));
    });

    console.log('\n🗺️  Detected Potential Elements:');
    console.log(JSON.stringify(structure, null, 2));

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await browser.close();
  }
}

discoverSelectors();
