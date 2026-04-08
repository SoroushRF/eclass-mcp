import http from 'http';
import { chromium } from 'playwright';
import { saveSession, isSessionValid } from '../scraper/session';
import url from 'url';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

dotenv.config({ quiet: true });

const AUTH_PORT = parseInt(process.env.AUTH_PORT || '3000', 10);
const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';
const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let authServerInstance: http.Server | null = null;
let authServerPort: number | null = null;

function getAuthServerPort(): number {
  return authServerPort ?? AUTH_PORT;
}

function listenOnPort(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('error', onError);
      reject(error);
    };

    server.once('error', onError);
    server.listen(port, () => {
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

export async function startAuthServer() {
  if (authServerInstance) return authServerInstance;

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '', true);

    if (parsedUrl.pathname === '/' || parsedUrl.pathname === '') {
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
    } else if (parsedUrl.pathname === '/auth') {
      try {
        const browser = await chromium.launch({ headless: false });
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
          } catch (e) {}
        }

        const cookies = await context.cookies();
        saveSession(cookies as any);
        const { cache } = await import('../cache/store');
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

        setTimeout(async () => {
          try { await browser.close(); } catch (e) {}
        }, 3000);
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Authentication failed: ${error.message}</h2>`);
      }
    } else if (parsedUrl.pathname === '/auth-cengage') {
      try {
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto('https://login.cengage.com/');

        await page.waitForURL(/(.*dashboard.*|.*webassign\.net\/web\/Student.*)/i, { timeout: AUTH_TIMEOUT_MS });
        
        await page.waitForTimeout(5000);

        const statePath = path.resolve(process.cwd(), '.eclass-mcp/cengage-state.json');
        const dir = path.dirname(statePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        await context.storageState({ path: statePath });
        
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

        setTimeout(async () => {
          try { await browser.close(); } catch (e) {}
        }, 3000);
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Cengage Authentication failed: ${error.message}</h2>`);
      }
    } else if (parsedUrl.pathname === '/status') {
      const authenticated = isSessionValid();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated }));
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

  console.error(`Auth server running at http://localhost:${authServerPort}`);

  authServerInstance = server;
  return server;
}

export function openAuthWindow() {
  const url = `http://localhost:${getAuthServerPort()}/auth`;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
  exec(cmd, (error) => {});
}
