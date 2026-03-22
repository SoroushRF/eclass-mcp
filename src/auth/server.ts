import http from 'http';
import { chromium } from 'playwright';
import { saveSession, isSessionValid } from '../scraper/session';
import url from 'url';
import dotenv from 'dotenv';
import { exec } from 'child_process';

dotenv.config({ quiet: true });

const AUTH_PORT = parseInt(process.env.AUTH_PORT || '3000', 10);
const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';
const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let authServerInstance: http.Server | null = null;

export function startAuthServer() {
  if (authServerInstance) return authServerInstance;

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '', true);

    if (parsedUrl.pathname === '/auth') {
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

        const cookies = await context.cookies();
        saveSession(cookies as any);

        await browser.close();

        // Sending complete HTML in one block
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
      } catch (error: any) {
        console.error('Auth error:', error);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Authentication failed: ${error.message}</h2>`);
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

  server.listen(AUTH_PORT, () => {
    console.error(`Auth server running at http://localhost:${AUTH_PORT}`);
  });

  authServerInstance = server;
  return server;
}

export function openAuthWindow() {
  const url = `http://localhost:${AUTH_PORT}/auth`;
  const cmd =
    process.platform === 'win32'
      ? `start ${url}`
      : process.platform === 'darwin'
        ? `open ${url}`
        : `xdg-open ${url}`;
  exec(cmd);
}
