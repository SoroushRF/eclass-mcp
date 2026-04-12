import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractDashboardCourseInventory } from '../src/scraper/cengage/dashboard-inventory';

function restoreGlobal(key: string, previous: unknown): void {
  if (typeof previous === 'undefined') {
    delete (globalThis as Record<string, unknown>)[key];
    return;
  }
  (globalThis as Record<string, unknown>)[key] = previous;
}

function runEvaluateInDom<TArg, TResult>(
  html: string,
  url: string,
  callback: ((arg: TArg) => TResult) | (() => TResult),
  arg?: TArg
): TResult {
  const dom = new JSDOM(html, { url });
  const { window } = dom;

  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 120,
      bottom: 24,
      width: 120,
      height: 24,
      toJSON: () => ({}) as object,
    }),
  });

  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;

  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;

  try {
    if (typeof arg === 'undefined') {
      return (callback as () => TResult)();
    }
    return (callback as (value: TArg) => TResult)(arg);
  } finally {
    restoreGlobal('window', prevWindow);
    restoreGlobal('document', prevDocument);
    restoreGlobal('HTMLElement', prevHTMLElement);
    window.close();
  }
}

describe('cengage dashboard inventory extraction', () => {
  it('extracts course inventory from entitlement cards', async () => {
    const html = `
      <article id="home-page-entitlement-card-1">
        <h3 class="home-page-title">MATH 1010 - Calculus I</h3>
        <a class="home-page-launch-course-link" href="https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-1010">
          Open course
        </a>
      </article>
    `;

    const page = {
      url: () => 'https://www.cengage.com/dashboard/home',
      evaluate: async (callback: unknown, arg?: unknown) =>
        runEvaluateInDom(
          html,
          'https://www.cengage.com/dashboard/home',
          callback as ((value: unknown) => unknown) | (() => unknown),
          arg
        ),
    };

    const courses = await extractDashboardCourseInventory(page as any);

    expect(courses).toHaveLength(1);
    expect(courses[0]).toEqual(
      expect.objectContaining({
        title: 'MATH 1010 - Calculus I',
        platform: 'webassign',
      })
    );
  });

  it('falls back to all anchor candidates when no entitlement cards are found', async () => {
    const html = `
      <main>
        <a href="https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-2020">
          CHEM 2020 - Organic Chemistry
        </a>
      </main>
    `;

    const page = {
      url: () => 'https://www.cengage.com/dashboard/home',
      evaluate: async (callback: unknown, arg?: unknown) =>
        runEvaluateInDom(
          html,
          'https://www.cengage.com/dashboard/home',
          callback as ((value: unknown) => unknown) | (() => unknown),
          arg
        ),
    };

    const courses = await extractDashboardCourseInventory(page as any);

    expect(courses.length).toBeGreaterThan(0);
    expect(courses[0]?.launchUrl).toContain('courseKey=WA-prod-2020');
  });
});
