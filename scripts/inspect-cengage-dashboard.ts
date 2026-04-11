import { chromium, type Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import {
  CENGAGE_STATE_PATH,
  getCengageSessionValidity,
} from '../src/scraper/cengage-session';
import { detectCengagePageState } from '../src/scraper/cengage-state';

const DEFAULT_ENTRY_URL = 'https://login.cengage.com/';
const DEBUG_DIR = path.resolve(
  __dirname,
  '../.eclass-mcp/debug/cengage-dashboard-inspect'
);
const LOGIN_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

interface LinkCandidate {
  href: string;
  text: string;
  title: string;
  ariaLabel: string;
  datasetCourseId: string;
  datasetCourseKey: string;
  visible: boolean;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const urlArg = argv.find((arg) => !arg.startsWith('--'));

  return {
    entryUrl: urlArg || DEFAULT_ENTRY_URL,
    headless: flags.has('--headless'),
  };
}

async function settlePage(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(
    () => null
  );
  await page.waitForTimeout(5000);
}

async function waitForAuthenticatedNavigation(page: Page) {
  console.log('Login page detected. Sign in in the visible browser window.');
  console.log(
    `Waiting up to ${Math.round(LOGIN_WAIT_TIMEOUT_MS / 60000)} minutes for Cengage/WebAssign to finish redirecting...`
  );

  await page
    .waitForURL(
      /(.*dashboard.*|.*webassign\.net\/web\/Student.*|.*webassign\.net\/v4cgi\/student.*|.*getenrolled\.com.*courseKey=.*)/i,
      { timeout: LOGIN_WAIT_TIMEOUT_MS }
    )
    .catch((error) => {
      throw new Error(
        `Timed out waiting for authenticated Cengage/WebAssign page after login: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });

  await settlePage(page);
}

async function collectLinkCandidates(page: Page): Promise<LinkCandidate[]> {
  return page.evaluate(() => {
    const normalizeText = (value: string | null | undefined) =>
      (value || '').replace(/\s+/g, ' ').trim();

    const isVisible = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    return Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href]')
    ).map((anchor) => ({
      href: anchor.href || '',
      text: normalizeText(anchor.textContent),
      title: normalizeText(anchor.getAttribute('title')),
      ariaLabel: normalizeText(anchor.getAttribute('aria-label')),
      datasetCourseId:
        normalizeText(anchor.getAttribute('data-course-id')) ||
        normalizeText(anchor.getAttribute('data-courseid')),
      datasetCourseKey:
        normalizeText(anchor.getAttribute('data-course-key')) ||
        normalizeText(anchor.getAttribute('data-coursekey')),
      visible: isVisible(anchor),
    }));
  });
}

function filterInterestingLinks(links: LinkCandidate[]) {
  return links.filter((link) => {
    const haystack = [
      link.href,
      link.text,
      link.title,
      link.ariaLabel,
      link.datasetCourseId,
      link.datasetCourseKey,
    ]
      .join(' ')
      .toLowerCase();

    return (
      haystack.includes('webassign') ||
      haystack.includes('cengage') ||
      haystack.includes('coursekey') ||
      haystack.includes('assignment') ||
      haystack.includes('dashboard') ||
      haystack.includes('student')
    );
  });
}

async function main() {
  const { entryUrl, headless } = parseArgs(process.argv.slice(2));
  const validity = getCengageSessionValidity();

  if (!validity.valid) {
    console.error(
      `No valid Cengage session state found (${validity.reason}). Authenticate first at /auth-cengage.`
    );
    process.exit(1);
  }

  ensureDir(DEBUG_DIR);

  console.log(`Using Cengage storage state: ${CENGAGE_STATE_PATH}`);
  console.log(`Opening entry URL: ${entryUrl}`);
  console.log(
    headless
      ? 'Running in headless mode.'
      : 'Launching visible browser for easier inspection.'
  );

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: validity.statePath,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 960 },
  });

  const page = await context.newPage();

  try {
    await page.goto(entryUrl, { waitUntil: 'load', timeout: 45000 });
    await settlePage(page);

    let state = await detectCengagePageState(page);
    if (state.state === 'login' && !headless) {
      await waitForAuthenticatedNavigation(page);
      state = await detectCengagePageState(page);
    }

    const html = await page.content();
    const title = await page.title();
    const links = await collectLinkCandidates(page);
    const interestingLinks = filterInterestingLinks(links);

    const htmlPath = path.join(DEBUG_DIR, 'page.html');
    const screenshotPath = path.join(DEBUG_DIR, 'page.png');
    const summaryPath = path.join(DEBUG_DIR, 'summary.json');
    const linksPath = path.join(DEBUG_DIR, 'links.json');
    const interestingLinksPath = path.join(DEBUG_DIR, 'interesting-links.json');

    fs.writeFileSync(htmlPath, html, 'utf-8');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          inspected_at: new Date().toISOString(),
          entryUrl,
          finalUrl: page.url(),
          title,
          state,
          totalLinks: links.length,
          interestingLinks: interestingLinks.length,
        },
        null,
        2
      ),
      'utf-8'
    );

    fs.writeFileSync(linksPath, JSON.stringify(links, null, 2), 'utf-8');
    fs.writeFileSync(
      interestingLinksPath,
      JSON.stringify(interestingLinks, null, 2),
      'utf-8'
    );

    console.log(`Final URL: ${page.url()}`);
    console.log(`Title: ${title}`);
    console.log(`Detected state: ${state.state} (${state.reason})`);
    console.log(`Saved HTML: ${htmlPath}`);
    console.log(`Saved screenshot: ${screenshotPath}`);
    console.log(`Saved summary: ${summaryPath}`);
    console.log(`Saved all links: ${linksPath}`);
    console.log(`Saved interesting links: ${interestingLinksPath}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
