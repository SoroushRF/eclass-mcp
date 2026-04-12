import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { chromium } from 'playwright';
import { loadSession } from '../src/scraper/session';
import {
  EClassBrowserSession,
  ECLASS_URL,
} from '../src/scraper/eclass/browser-session';
import { SessionExpiredError } from '../src/scraper/eclass/types';

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

describe('eclass browser session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses a launched browser instance across calls', async () => {
    const browser = {
      newContext: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    vi.mocked(chromium.launch).mockResolvedValue(browser as any);

    const session = new EClassBrowserSession();
    const first = await session.getBrowser();
    const second = await session.getBrowser();

    expect(first).toBe(second);
    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(chromium.launch).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true })
    );
  });

  it('throws SessionExpiredError when no cookies are available', async () => {
    const context = {
      addInitScript: vi.fn(async () => undefined),
      addCookies: vi.fn(async () => undefined),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    };
    vi.mocked(chromium.launch).mockResolvedValue(browser as any);
    vi.mocked(loadSession).mockReturnValue([] as any);

    const session = new EClassBrowserSession();

    await expect(session.getAuthenticatedContext()).rejects.toBeInstanceOf(
      SessionExpiredError
    );
    expect(browser.newContext).not.toHaveBeenCalled();
  });

  it('creates authenticated context and installs anti-automation script', async () => {
    const addInitScript = vi.fn(async () => undefined);
    const addCookies = vi.fn(async () => undefined);
    const context = {
      addInitScript,
      addCookies,
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => undefined),
    };

    const cookies = [
      {
        name: 'MoodleSession',
        value: 'token',
        domain: 'eclass.yorku.ca',
        path: '/',
      },
    ];

    vi.mocked(chromium.launch).mockResolvedValue(browser as any);
    vi.mocked(loadSession).mockReturnValue(cookies as any);

    const session = new EClassBrowserSession();
    const authenticated = await session.getAuthenticatedContext();

    expect(authenticated).toBe(context);
    expect(browser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'en-CA',
        viewport: { width: 1920, height: 1080 },
      })
    );
    expect(addInitScript).toHaveBeenCalledTimes(1);
    expect(addCookies).toHaveBeenCalledWith(cookies);
  });

  it('dumps page HTML to debug directory and handles dump failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const mkdirSpy = vi
      .spyOn(fs, 'mkdirSync')
      .mockImplementation(() => '' as any);
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined as any);

    const session = new EClassBrowserSession();
    const okPage = {
      content: vi.fn(async () => '<html><body>ok</body></html>'),
    };

    await session.dumpPage(okPage as any, 'ok-page');

    expect(existsSpy).toHaveBeenCalledTimes(1);
    expect(mkdirSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Dumped page to ok-page.html for debugging.'
    );

    const failingPage = {
      content: vi.fn(async () => {
        throw new Error('cannot read page');
      }),
    };

    await session.dumpPage(failingPage as any, 'bad-page');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to dump debug page bad-page:')
    );
  });

  it('closes browser once and resets internal state', async () => {
    const browser = {
      newContext: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    vi.mocked(chromium.launch).mockResolvedValue(browser as any);

    const session = new EClassBrowserSession();
    await session.getBrowser();

    await session.close();
    await session.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('uses the expected base eClass URL constant', () => {
    expect(ECLASS_URL).toContain('eclass.yorku.ca');
  });
});
