import http from 'http';
import { chromium, Cookie } from 'playwright';
import { saveSession, isSessionPersistent } from '../scraper/session.js';
import url from 'url';
import dotenv from 'dotenv';

dotenv.config();

const AUTH_PORT = parseInt(process.env.AUTH_PORT || '3000', 10);
const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';

export function startAuthServer() {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '', true);

    if (parsedUrl.pathname === '/auth') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<h1>Authenticating... Check the browser window that just opened.</h1>');
      
      try {
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(ECLASS_URL);

        // Wait for the user to land on the dashboard (indicated by /my/ in the URL)
        // or any other indicator that they are logged in.
        // York eClass dashboard is usually https://eclass.yorku.ca/my/
        await page.waitForURL(/.*\/my\/.*/, { timeout: 0 });

        const cookies = await context.cookies();
        saveSession(cookies as any); // Cast because our Cookie interface matches PW's closely enough

        await browser.close();

        res.end('<h2>Connected! You can close this tab and return to Claude.</h2>');
      } catch (error) {
        console.error('Auth error:', error);
        res.end(`<h2>Authentication failed: ${error}</h2>`);
      }
    } else if (parsedUrl.pathname === '/status') {
      const authenticated = isSessionPersistent();
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
