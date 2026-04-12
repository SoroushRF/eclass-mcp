import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { getCengageSessionValidity } from '../src/scraper/cengage-session';

async function main() {
  const validity = getCengageSessionValidity();
  if (!validity.valid) {
    throw new Error(`Cengage session invalid: ${validity.reason}`);
  }

  const launchUrl =
    'https://www.webassign.net/v4cgi/login.pl?pid=571417&eISBN=9780357128992&courseKey=WA-production-1607530&titleIsbn=9781337613927';

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: validity.statePath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });

  const page = await context.newPage();
  await page.goto(launchUrl, { waitUntil: 'load', timeout: 60000 });
  await page
    .waitForURL(
      /(.*webassign\.net\/web\/Student.*|.*webassign\.net\/v4cgi\/student.*)/i,
      { timeout: 60000 }
    )
    .catch(() => null);
  await page.waitForTimeout(2000);

  const pastTab = page
    .locator(
      'button[data-analytics="past-assignments-tab"], [role="tab"][data-analytics="past-assignments-tab"], button[aria-label*="Past Assignments"]'
    )
    .first();
  if (await pastTab.count()) {
    const selected =
      ((await pastTab.getAttribute('aria-selected')) || '').toLowerCase() ===
      'true';
    if (!selected) {
      await pastTab.click({ timeout: 4000 });
      await page.waitForTimeout(1500);
    }
  }

  const firstAssignmentLink = page
    .locator('a[data-test^="assignment_link_"]')
    .first();
  if (!(await firstAssignmentLink.count())) {
    throw new Error('No assignment link found on assignment page.');
  }

  const href = (await firstAssignmentLink.getAttribute('href')) || '';
  await firstAssignmentLink.click({ timeout: 5000 });
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(2500);

  const html = await page.content();
  const stats = await page.evaluate(() => {
    const pick = (sel: string) => document.querySelectorAll(sel).length;
    const sampleText = (el: Element | null) =>
      (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return {
      url: location.href,
      title: document.title || '',
      h1: sampleText(document.querySelector('h1')),
      h2: sampleText(document.querySelector('h2')),
      counts: {
        questionByDataTest: pick(
          '[data-test*="question"], [data-testid*="question"]'
        ),
        questionByClass: pick(
          '.question, [class*="question"], .problem, [class*="problem"]'
        ),
        inputFields: pick('input, textarea, select'),
        forms: pick('form'),
        tables: pick('table'),
      },
      sampleAnchors: Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 12)
        .map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          dataTest: a.getAttribute('data-test') || '',
          cls: a.className || '',
        })),
    };
  });

  const outDir = path.resolve('.eclass-mcp/debug/cengage-assignment-inspect');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'assignment1.html'), html, 'utf-8');
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify({ launchUrl, clickedHref: href, stats }, null, 2),
    'utf-8'
  );
  await page.screenshot({
    path: path.join(outDir, 'assignment1.png'),
    fullPage: true,
  });

  await context.close();
  await browser.close();

  console.log(JSON.stringify({ outDir, clickedHref: href, stats }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
