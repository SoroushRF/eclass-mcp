import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import {
  AUTH_HOST,
  closeAuthBrowsers,
  getAuthUrl,
  startAuthServer,
  stopAuthServer,
} from '../src/auth/server';
import * as authSessionWipe from '../src/security/auth-session-wipe';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

const originalSessionSecret = process.env.ECLASS_MCP_SESSION_SECRET;

function request(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { agent: false }, (res) => {
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

function post(
  url: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http
      .request(url, {
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      })
      .on('response', (res) => {
        let responseBody = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      })
      .on('error', reject);
    req.end(body);
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

describe.sequential('auth server shutdown', () => {
  beforeEach(async () => {
    await stopAuthServer();
    await closeAuthBrowsers();
    vi.clearAllMocks();
    process.env.ECLASS_MCP_SESSION_SECRET = 'x'.repeat(32);
  });

  afterEach(async () => {
    await stopAuthServer();
    await closeAuthBrowsers();
    vi.restoreAllMocks();
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
    const address = server.address();
    expect(address).toMatchObject({ address: AUTH_HOST });
    expect(getAuthUrl()).toMatch(/^http:\/\/127\.0\.0\.1:/);

    await expect(stopAuthServer()).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
    await expect(stopAuthServer()).resolves.toBeUndefined();
  });

  it('closes launched auth browsers when auth route handling fails', async () => {
    const { browser } = mockAuthBrowser({
      goto: vi.fn(async () => {
        throw new Error('navigation failed');
      }),
    });

    await startAuthServer();
    const responsePromise = request(getAuthUrl('eclass')).catch((error) => ({
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    }));
    await waitForAssertion(() =>
      expect(chromium.launch).toHaveBeenCalledTimes(1)
    );
    const response = await responsePromise;

    expect([0, 500]).toContain(response.status);
    await waitForAssertion(() =>
      expect(browser.close).toHaveBeenCalledTimes(1)
    );
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

  it('requires a same-origin CSRF nonce before clearing auth sessions', async () => {
    const clearSpy = vi
      .spyOn(authSessionWipe, 'clearAllAuthSessions')
      .mockReturnValue({ removed: [], missing: [], errors: [] });

    await startAuthServer();
    const logoutUrl = getAuthUrl().replace('/auth', '/logout');
    const page = await request(logoutUrl);
    const csrf = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    expect(page.status).toBe(200);
    expect(csrf).toMatch(/^[a-f0-9]{64}$/);

    const origin = new URL(logoutUrl).origin;
    const missing = await post(logoutUrl, '_csrf=wrong', { Origin: origin });
    expect(missing.status).toBe(403);
    expect(JSON.parse(missing.body)).toMatchObject({
      code: 'CSRF_INVALID',
    });
    expect(clearSpy).not.toHaveBeenCalled();

    const forged = await post(
      logoutUrl,
      `_csrf=${csrf}`,
      { Origin: 'http://localhost:3000' }
    );
    expect(forged.status).toBe(403);
    expect(clearSpy).not.toHaveBeenCalled();

    const valid = await post(logoutUrl, `_csrf=${csrf}`, {
      Origin: origin,
      Referer: logoutUrl,
    });
    expect(valid.status).toBe(200);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('HTML-escapes authentication errors', async () => {
    mockAuthBrowser({
      goto: vi.fn(async () => {
        throw new Error('<script>alert("xss")</script>');
      }),
    });

    await startAuthServer();
    const response = await request(getAuthUrl('eclass'));
    expect(response.status).toBe(500);
    expect(response.body).not.toContain('<script>alert');
    expect(response.body).toContain(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });
});
