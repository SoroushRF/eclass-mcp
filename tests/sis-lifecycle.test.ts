import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { loadSession } from '../src/scraper/session';
import { closeActiveSisBrowsers, SISScraper } from '../src/scraper/sis';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

vi.mock('../src/scraper/session', async () => {
  const actual = await vi.importActual<typeof import('../src/scraper/session')>(
    '../src/scraper/session'
  );
  return {
    ...actual,
    loadSession: vi.fn(),
  };
});

function sessionCookies(): ReturnType<typeof loadSession> {
  return [
    {
      name: 'MoodleSession',
      value: 'token',
      domain: 'eclass.yorku.ca',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 3600,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ];
}

function mockSisBrowser(pageOverrides: Record<string, unknown> = {}) {
  const page = {
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce([]),
    ...pageOverrides,
  };
  const context = {
    addInitScript: vi.fn(async () => undefined),
    addCookies: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };

  vi.mocked(chromium.launch).mockResolvedValue(
    browser as unknown as Awaited<ReturnType<typeof chromium.launch>>
  );

  return { browser, context, page };
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 40; i++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

describe('SIS browser lifecycle registry', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(loadSession).mockReturnValue(sessionCookies());
    await closeActiveSisBrowsers();
  });

  it('keeps normal per-call browser cleanup unchanged', async () => {
    const { browser } = mockSisBrowser();

    await new SISScraper().scrapeExams();
    await closeActiveSisBrowsers();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('closes active SIS browsers during shutdown cleanup', async () => {
    let resolveGoto: (() => void) | undefined;
    const { browser, page } = mockSisBrowser({
      goto: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveGoto = resolve;
          })
      ),
    });

    const scrapePromise = new SISScraper().scrapeExams();
    await waitForAssertion(() => expect(page.goto).toHaveBeenCalledTimes(1));

    await closeActiveSisBrowsers();
    expect(browser.close).toHaveBeenCalledTimes(1);

    resolveGoto?.();
    await scrapePromise;
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
