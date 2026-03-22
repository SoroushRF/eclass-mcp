import { chromium } from 'playwright';
import { loadSession } from '../src/scraper/session';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

async function inspectSIS() {
  const cookies = loadSession();
  if (!cookies) {
    console.error('No session found. Please run the auth flow first.');
    process.exit(1);
  }

  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  // Anti-bot init scripts
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  await context.addCookies(cookies);

  const debugDir = path.join(process.cwd(), '.eclass-mcp', 'debug');
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  const pages = [
    { name: 'timetable', url: 'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/cds' },
    { name: 'exams', url: 'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/ede' }
  ];

  for (const p of pages) {
    console.log(`Inspecting ${p.name}: ${p.url}...`);
    const page = await context.newPage();
    try {
      await page.goto(p.url, { waitUntil: 'networkidle', timeout: 30000 });
      
      const title = await page.title();
      const finalUrl = page.url();
      const html = await page.content();
      
      console.log(`[${p.name}] Title: ${title}`);
      console.log(`[${p.name}] Final URL: ${finalUrl}`);

      // Basic structure probe
      const tableCount = await page.evaluate(() => document.querySelectorAll('table').length);
      console.log(`[${p.name}] Table count: ${tableCount}`);

      // Save HTML
      const filePath = path.join(debugDir, `sis_${p.name}.html`);
      fs.writeFileSync(filePath, html);
      console.log(`[${p.name}] HTML dumped to: ${filePath}`);

      // --- Timetable Session Selection Logic ---
      if (p.name === 'timetable') {
        const sessionLink = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          // Look for FALL/WINTER 2025-2026 UNDERGRADUATE STUDENTS or similar
          const target = links.find(a => 
            a.textContent?.includes('UNDERGRADUATE STUDENTS') && 
            a.textContent?.includes('2025-2026')
          );
          return target ? target.href : null;
        });

        if (sessionLink) {
          console.log(`[timetable] Found session link: ${sessionLink}`);
          await page.goto(sessionLink, { waitUntil: 'networkidle' });
          const gridHtml = await page.content();
          const gridPath = path.join(debugDir, `sis_timetable_grid.html`);
          fs.writeFileSync(gridPath, gridHtml);
          console.log(`[timetable] Grid HTML dumped to: ${gridPath}`);
        } else {
          console.warn('[timetable] No UNDERGRADUATE session link found.');
        }
      }

    } catch (error: any) {
      console.error(`Error inspecting ${p.name}:`, error.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log('Inspection complete.');
}

inspectSIS().catch(console.error);
