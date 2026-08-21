import http from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';
import { chromium, type Browser } from 'playwright';
import { saveSession, isSessionValid, type Cookie } from '../scraper/session';
import {
  CENGAGE_STATE_PATH,
  getCengageSessionValidity,
  saveCengageSessionState,
} from '../scraper/cengage-session';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import {
  SecureSessionStorageError,
  assertSecureSessionConfigured,
  isSecureSessionConfigured,
} from '../security/secure-session-store';
import { clearAllAuthSessions } from '../security/auth-session-wipe';
import {
  clearActiveEclassAccountScope,
  getActiveEclassAccountScope,
} from '../cache/account-scope';

dotenv.config({ quiet: true });

const AUTH_PORT = parseInt(process.env.AUTH_PORT || '3000', 10);
export const AUTH_HOST = '127.0.0.1';
const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';
const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_LOGOUT_BODY_BYTES = 4096;
export const DEFAULT_AUTH_WAIT_MS = 2 * 60 * 1000;
export const DEFAULT_AUTH_POLL_INTERVAL_MS = 1000;

let authServerInstance: http.Server | null = null;
let authServerPort: number | null = null;
let authCsrfNonce: string | null = null;
const activeAuthBrowsers = new Set<Browser>();

function getAuthServerPort(): number {
  return authServerPort ?? AUTH_PORT;
}

function getAuthOrigin(): string {
  return `http://${AUTH_HOST}:${getAuthServerPort()}`;
}

type AuthPlatform = 'eclass' | 'cengage';

const AUTH_PATHS: Record<AuthPlatform, string> = {
  eclass: '/auth',
  cengage: '/auth-cengage',
};

export function getAuthUrl(platform: AuthPlatform = 'eclass'): string {
  return `${getAuthOrigin()}${AUTH_PATHS[platform]}`;
}

export function resolveAuthWaitMs(
  value: string | undefined = process.env.ECLASS_MCP_AUTH_WAIT_MS
): number {
  if (!value) return DEFAULT_AUTH_WAIT_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_AUTH_WAIT_MS;
  }
  return parsed;
}

export function resolveCengageAuthWaitMs(
  value: string | undefined = process.env.ECLASS_MCP_CENGAGE_AUTH_WAIT_MS
): number {
  if (!value) return resolveAuthWaitMs();
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return resolveAuthWaitMs();
  }
  return parsed;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForAuthSession(options?: {
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<boolean> {
  if (!isSecureSessionConfigured()) return false;
  const timeoutMs = options?.timeoutMs ?? resolveAuthWaitMs();
  const pollIntervalMs =
    options?.pollIntervalMs ?? DEFAULT_AUTH_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (isSessionValid()) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await wait(Math.min(pollIntervalMs, remainingMs));
  }

  return isSessionValid();
}

export async function waitForCengageAuthSession(options?: {
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<boolean> {
  if (!isSecureSessionConfigured()) return false;
  const timeoutMs = options?.timeoutMs ?? resolveCengageAuthWaitMs();
  const pollIntervalMs =
    options?.pollIntervalMs ?? DEFAULT_AUTH_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (getCengageSessionValidity().valid) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await wait(Math.min(pollIntervalMs, remainingMs));
  }

  return getCengageSessionValidity().valid;
}

function listenOnPort(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('error', onError);
      reject(error);
    };

    server.once('error', onError);
    server.listen({ host: AUTH_HOST, port }, () => {
      server.off('error', onError);

      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
        return;
      }

      reject(new Error('Auth server failed to report a listening port.'));
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character
  );
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getHeaderValue(
  headers: http.IncomingHttpHeaders,
  name: string
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isSameOriginRequest(req: http.IncomingMessage): boolean {
  const expectedOrigin = getAuthOrigin();
  const origin = getHeaderValue(req.headers, 'origin');
  const referer = getHeaderValue(req.headers, 'referer');

  for (const candidate of [origin, referer]) {
    if (!candidate?.trim()) continue;
    try {
      if (new URL(candidate).origin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }

  return true;
}

function readRequestBody(
  req: http.IncomingMessage,
  maxBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;

    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      receivedBytes += Buffer.byteLength(chunk, 'utf8');
      if (receivedBytes > maxBytes) return;
      body += chunk;
    });
    req.on('end', () => {
      if (receivedBytes > maxBytes) {
        reject(new Error('Request body exceeds the allowed size.'));
        return;
      }
      resolve(body);
    });
    req.on('error', reject);
  });
}

function writeInvalidCsrfResponse(res: http.ServerResponse): void {
  res.writeHead(403, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(
    JSON.stringify({
      code: 'CSRF_INVALID',
      message: 'Invalid logout request.',
    })
  );
}

function isValidLogoutRequest(req: http.IncomingMessage, body: string): boolean {
  if (!authCsrfNonce || !isSameOriginRequest(req)) return false;
  const submittedNonce = new URLSearchParams(body).get('_csrf') ?? '';
  return constantTimeEquals(submittedNonce, authCsrfNonce);
}

function trackAuthBrowser(browser: Browser): Browser {
  activeAuthBrowsers.add(browser);
  return browser;
}

async function closeTrackedAuthBrowser(browser: Browser): Promise<void> {
  if (!activeAuthBrowsers.delete(browser)) {
    return;
  }

  try {
    await browser.close();
  } catch {
    // Browser may already be closed by the user or Playwright.
  }
}

function scheduleAuthBrowserClose(browser: Browser, delayMs: number): void {
  const timeout = setTimeout(() => {
    void closeTrackedAuthBrowser(browser);
  }, delayMs);
  timeout.unref?.();
}

export async function closeAuthBrowsers(): Promise<void> {
  const browsers = Array.from(activeAuthBrowsers);
  activeAuthBrowsers.clear();

  await Promise.allSettled(
    browsers.map(async (browser) => {
      try {
        await browser.close();
      } catch {
        // Best-effort cleanup during shutdown.
      }
    })
  );
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function stopAuthServer(): Promise<void> {
  const server = authServerInstance;
  authServerInstance = null;
  authServerPort = null;
  authCsrfNonce = null;

  await Promise.all([
    server ? closeHttpServer(server).catch(() => undefined) : Promise.resolve(),
    closeAuthBrowsers(),
  ]);
}

function secureSessionConfigHtml(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : 'Secure session storage is unavailable.';
  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: sans-serif; max-width: 720px; margin: 48px auto; line-height: 1.5;">
        <h2>Secure session storage is not configured</h2>
        <p>${escapeHtml(message)}</p>
        <p>Set <code>ECLASS_MCP_SESSION_SECRET</code> in <code>.env</code> to a long local secret, restart the MCP server, then authenticate again.</p>
        <p>If old plaintext sessions exist, visit <code>/logout</code> after setting the secret or delete the old auth files under <code>.eclass-mcp/</code>.</p>
      </body>
    </html>
  `;
}

export async function startAuthServer() {
  if (authServerInstance) return authServerInstance;

  authCsrfNonce = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(
      req.url || '/',
      getAuthOrigin()
    );
    const pathname = requestUrl.pathname;

    if (pathname === '/' || pathname === '') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
          <!DOCTYPE html>
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
              <h2 style="color: #2c3e50;">eClass MCP Local Server</h2>
              <p>Select a platform to authenticate:</p>
              <ul style="list-style: none; padding: 0;">
                <li style="margin: 10px;"><a href="/auth" style="color: #3498db; text-decoration: none; font-weight: bold;">Login to eClass</a></li>
                <li style="margin: 10px;"><a href="/auth-cengage" style="color: #e74c3c; text-decoration: none; font-weight: bold;">Login to Cengage/WebAssign</a></li>
              </ul>
            </body>
          </html>
        `);
    } else if (pathname === '/auth') {
      let browser: Browser | null = null;
      try {
        assertSecureSessionConfigured();
        browser = trackAuthBrowser(await chromium.launch({ headless: false }));
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(ECLASS_URL);

        // York eClass dashboard is usually https://eclass.yorku.ca/my/
        // Added 10-minute timeout
        // Wait for login to complete (redirects to /my/)
        await page.waitForURL(/.*\/my\/.*/, { timeout: AUTH_TIMEOUT_MS });

        // Visit a WAF-protected resource page so the real browser completes the
        // AWS WAF bot challenge and acquires the aws-waf-token cookie.
        // Without this, headless requests to /mod/resource/view.php get blocked.
        try {
          await page.goto(`${ECLASS_URL}/mod/resource/view.php`, {
            timeout: 15000,
            waitUntil: 'networkidle',
          });
        } catch {
          /* page might 404, that's fine — we just need the WAF cookie */
        }

        // --- SIS Cookie Bridging ---
        const SIS_URLS = [
          'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/cde',
          'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/ede',
        ];

        for (const sisUrl of SIS_URLS) {
          try {
            await page.goto(sisUrl, { timeout: 10000, waitUntil: 'load' });
          } catch (_error) {
            // Ignore SIS bridge failures; eClass auth can still succeed.
          }
        }

        const cookies: Cookie[] = await context.cookies();
        saveSession(cookies);
        const previousAccountScope = getActiveEclassAccountScope();
        const { closeAllEclassApiSessionContexts } = await import(
          '../scraper/eclass/api/session-context'
        );
        await closeAllEclassApiSessionContexts();
        clearActiveEclassAccountScope();
        const { cache } = await import('../cache/store');
        if (previousAccountScope) {
          cache.clearEclassAccountScope(previousAccountScope);
        }
        cache.clearVolatile();

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
              <h2 style="color: #2c3e50;">Connected!</h2>
              <p>Your session has been saved. You can close this tab and return to Claude.</p>
            </body>
          </html>
        `);

        scheduleAuthBrowserClose(browser, 3000);
        browser = null;
      } catch (error) {
        if (error instanceof SecureSessionStorageError) {
          res.writeHead(503, { 'Content-Type': 'text/html' });
          res.end(secureSessionConfigHtml(error));
          return;
        }
        if (browser) {
          await closeTrackedAuthBrowser(browser);
          browser = null;
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown authentication error';
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(
          `<h2>Authentication failed: ${escapeHtml(message)}</h2>`
        );
      } finally {
        if (browser) {
          await closeTrackedAuthBrowser(browser);
        }
      }
    } else if (pathname === '/auth-cengage') {
      let browser: Browser | null = null;
      try {
        assertSecureSessionConfigured();
        browser = trackAuthBrowser(await chromium.launch({ headless: false }));
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto('https://login.cengage.com/');

        await page.waitForURL(
          /(.*dashboard.*|.*webassign\.net\/web\/Student.*)/i,
          { timeout: AUTH_TIMEOUT_MS }
        );

        await page.waitForTimeout(5000);

        const storageState = await context.storageState();
        saveCengageSessionState(storageState, {
          statePath: CENGAGE_STATE_PATH,
        });

        const { clearCengageCacheArtifacts } = await import('../cache/store');
        clearCengageCacheArtifacts();

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
              <h2 style="color: #c0392b;">Cengage Connected!</h2>
              <p>Your Cengage session has been saved. You can close this tab and return to Claude.</p>
            </body>
          </html>
        `);

        scheduleAuthBrowserClose(browser, 3000);
        browser = null;
      } catch (error) {
        if (error instanceof SecureSessionStorageError) {
          res.writeHead(503, { 'Content-Type': 'text/html' });
          res.end(secureSessionConfigHtml(error));
          return;
        }
        if (browser) {
          await closeTrackedAuthBrowser(browser);
          browser = null;
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown authentication error';
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(
          `<h2>Cengage Authentication failed: ${escapeHtml(message)}</h2>`
        );
      } finally {
        if (browser) {
          await closeTrackedAuthBrowser(browser);
        }
      }
    } else if (pathname === '/status') {
      const secureSessionConfigured = isSecureSessionConfigured();
      let authenticated = false;
      try {
        authenticated = secureSessionConfigured ? isSessionValid() : false;
      } catch {
        // Keep authenticated=false when the configured secret cannot decrypt
        // existing auth material.
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated, secureSessionConfigured }));
    } else if (pathname === '/logout') {
      if (req.method === 'POST') {
        let body: string;
        try {
          body = await readRequestBody(req, MAX_LOGOUT_BODY_BYTES);
        } catch {
          writeInvalidCsrfResponse(res);
          return;
        }
        if (!isValidLogoutRequest(req, body)) {
          writeInvalidCsrfResponse(res);
          return;
        }
        const { closeAllEclassApiSessionContexts } = await import(
          '../scraper/eclass/api/session-context'
        );
        await closeAllEclassApiSessionContexts();
        const result = clearAllAuthSessions();
        const status = result.errors.length > 0 ? 500 : 200;
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(result));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <body style="font-family: sans-serif; max-width: 720px; margin: 48px auto; line-height: 1.5;">
              <h2>Clear local auth sessions?</h2>
              <p>This removes encrypted eClass/SIS and Cengage/WebAssign auth session files from <code>.eclass-mcp/</code>. It does not delete cache, pins, debug output, or course-platform mappings.</p>
              <form method="POST" action="/logout">
                <input type="hidden" name="_csrf" value="${escapeHtml(authCsrfNonce ?? '')}">
                <button type="submit" style="padding: 8px 14px;">Clear auth sessions</button>
              </form>
            </body>
          </html>
        `);
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    authServerPort = await listenOnPort(server, AUTH_PORT);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EADDRINUSE') {
      throw error;
    }
    authServerPort = await listenOnPort(server, 0);
  }

  console.error(`Auth server running at ${getAuthOrigin()}`);

  authServerInstance = server;
  return server;
}

export function openAuthWindow(platform: AuthPlatform = 'eclass') {
  const url = getAuthUrl(platform);
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
  exec(cmd, () => {});
}
