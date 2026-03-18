import http from 'http';
import { chromium } from 'playwright';
import { saveSession, isSessionValid } from '../scraper/session';
import url from 'url';
import dotenv from 'dotenv';

dotenv.config();

const AUTH_PORT = parseInt(process.env.AUTH_PORT || '3000', 10);
const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';
const AUTH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function startAuthServer() {
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
        await page.waitForURL(/.*\/my\/.*/, { timeout: AUTH_TIMEOUT_MS });

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
    console.error(`Visit http://localhost:${AUTH_PORT}/auth to log in to eClass.`);
  });

  return server;
}
