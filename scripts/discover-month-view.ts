import { chromium } from 'playwright';
import { loadSession } from '../src/scraper/session';
import fs from 'fs';
import path from 'path';

async function discoverMonth() {
  console.log('📅 Discovering Month View Selectors...');
  
  try {
    const session = await loadSession();
    if (!session) {
      console.error('❌ No session found. Run auth first.');
      return;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(session);
    const page = await context.newPage();

    console.log('📍 Navigating to Month View...');
    await page.goto('https://eclass.yorku.ca/calendar/view.php?view=month', { waitUntil: 'networkidle' });

    // Look for Navigation Buttons (Prev/Next month)
    const navLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="view=month"]'));
      return links.map(li => ({
        text: li.textContent?.trim(),
        href: (li as HTMLAnchorElement).href,
        dataView: li.getAttribute('data-view')
      }));
    });

    console.log('\n🗺️  Navigation Links Found:');
    console.log(JSON.stringify(navLinks, null, 2));

    // Look for events in the grid
    const eventCount = await page.evaluate(() => document.querySelectorAll('.calendar_event_course').length);
    console.log(`\n🔍 Found ${eventCount} events in the grid.`);

    const debugDir = path.join(process.cwd(), '.eclass-mcp', 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    const htmlPath = path.join(debugDir, 'month_view_discovery.html');
    fs.writeFileSync(htmlPath, await page.content());
    console.log(`📂 HTML Dumped to: ${htmlPath}`);

    await browser.close();
  } catch (error) {
    console.error('❌ ERROR:', error);
  }
}

discoverMonth();
