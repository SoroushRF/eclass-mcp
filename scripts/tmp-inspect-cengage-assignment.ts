import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { CengageScraper } from '../src/scraper/cengage';
import { getCengageSessionValidity } from '../src/scraper/cengage-session';

async function main() {
  const scraper = new CengageScraper();
  const launchUrl =
    'https://www.webassign.net/v4cgi/login.pl?pid=571417&eISBN=9780357128992&courseKey=WA-production-1607530&titleIsbn=9781337613927';
  const assignments = await scraper.getAssignments(launchUrl);
  await scraper.close();

  if (!assignments.length || !assignments[0]?.url) {
    console.log('No assignment url found');
    return;
  }

  const firstUrl = assignments[0].url;
  const absoluteUrl = /^https?:/i.test(firstUrl)
    ? firstUrl
    : `https://www.webassign.net${firstUrl.startsWith('/') ? '' : '/'}${firstUrl}`;

  const validity = getCengageSessionValidity();
  if (!validity.valid) {
    throw new Error(`Cengage session invalid: ${validity.reason}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: validity.statePath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });

  const page = await context.newPage();
  await page.goto(absoluteUrl, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);

  const html = await page.content();
  const stats = await page.evaluate(() => {
    const pick = (sel: string) => document.querySelectorAll(sel).length;
    return {
      url: location.href,
      title: document.title || '',
      h1: (document.querySelector('h1')?.textContent || '').trim(),
      h2: (document.querySelector('h2')?.textContent || '').trim(),
      counts: {
        dataTestQuestion: pick(
          '[data-test*="question"], [data-testid*="question"]'
        ),
        classQuestion: pick(
          '.question, .Question, [class*="question"], [class*="problem"]'
        ),
        prompt: pick('pre, .prompt, [class*="prompt"]'),
        input: pick('input, textarea, select'),
        table: pick('table'),
      },
    };
  });

  const outDir = path.resolve('.eclass-mcp/debug/cengage-assignment-inspect');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'assignment1.html'), html, 'utf-8');
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify({ firstUrl, absoluteUrl, stats }, null, 2),
    'utf-8'
  );
  await page.screenshot({
    path: path.join(outDir, 'assignment1.png'),
    fullPage: true,
  });

  await context.close();
  await browser.close();

  console.log(
    JSON.stringify({ outDir, firstUrl, absoluteUrl, stats }, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
