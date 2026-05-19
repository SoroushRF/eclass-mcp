import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import {
  closeAuthBrowsers,
  getAuthUrl,
  startAuthServer,
  stopAuthServer,
} from '../src/auth/server';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

const originalSessionSecret = process.env.ECLASS_MCP_SESSION_SECRET;

function request(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      })
      .on('error', reject);
  });
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

function mockAuthBrowser(pageOverrides: Record<string, unknown> = {}) {
  const page = {
    goto: vi.fn(async () => undefined),
    waitForURL: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    ...pageOverrides,
  };
  const context = {
    newPage: vi.fn(async () => page),
    cookies: vi.fn(async () => []),
    storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
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

describe('auth server shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ECLASS_MCP_SESSION_SECRET = 'x'.repeat(32);
  });

  afterEach(async () => {
    await stopAuthServer();
    await closeAuthBrowsers();
    if (originalSessionSecret === undefined) {
      delete process.env.ECLASS_MCP_SESSION_SECRET;
    } else {
      process.env.ECLASS_MCP_SESSION_SECRET = originalSessionSecret;
    }
  });

  it('stops safely before start, after start, and on repeated calls', async () => {
    await expect(stopAuthServer()).resolves.toBeUndefined();

    const server = await startAuthServer();
    expect(server.listening).toBe(true);

    await expect(stopAuthServer()).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
    await expect(stopAuthServer()).resolves.toBeUndefined();
  });

  it('closes tracked auth browsers during shutdown', async () => {
    let rejectWaitForUrl: (error: Error) => void = () => undefined;
    const { browser, page } = mockAuthBrowser({
      waitForURL: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWaitForUrl = reject;
          })
      ),
    });

    await startAuthServer();
    const responsePromise = request(getAuthUrl('eclass'));
    await waitForAssertion(() =>
      expect(page.waitForURL).toHaveBeenCalledTimes(1)
    );

    await closeAuthBrowsers();
    expect(browser.close).toHaveBeenCalledTimes(1);

    rejectWaitForUrl(new Error('browser closed'));
    const response = await responsePromise;
    expect(response.status).toBe(500);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('closes launched auth browsers when auth route handling fails', async () => {
    const { browser } = mockAuthBrowser({
      goto: vi.fn(async () => {
        throw new Error('navigation failed');
      }),
    });

    await startAuthServer();
    const response = await request(getAuthUrl('eclass')).catch((error) => ({
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    }));

    expect([0, 500]).toContain(response.status);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
