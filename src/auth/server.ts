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

        // --- SIS Cookie Bridging (Task 12) ---
        // Bridge to York SIS to capture SSO cookies for Exam Schedule and Timetable.
        // DirectAction URLs are more stable than the session-based WO URLs.
        const SIS_URLS = [
          'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/cde', // Course Timetable
          'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/ede', // Exam Schedule
        ];

        console.error('Login detected. Starting SIS cookie bridge...');
        for (const sisUrl of SIS_URLS) {
          try {
            console.error(`Navigating to SIS: ${sisUrl}...`);
            await page.goto(sisUrl, { timeout: 10000, waitUntil: 'load' });
            console.error(`Successfully hit ${sisUrl}`);
          } catch (e) {
            console.error(`SIS bridge skipped for ${sisUrl}:`, (e as Error).message);
          }
        }

        console.error('Capturing context cookies...');
        const cookies = await context.cookies();
        
        console.error(`Saving session with ${cookies.length} cookies...`);
        saveSession(cookies as any);

        // Sending complete HTML in one block so the user sees success immediately.
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

        console.error('Sent Connected message to user browser.');

        console.error('Waiting 3 seconds before closing auth browser...');
        setTimeout(async () => {
          try {
            await browser.close();
            console.error('Auth browser closed successfully.');
          } catch (e) {
            console.error('Error closing auth browser:', e);
          }
        }, 3000);
        
        console.error('Auth flow complete (browser closing in 3s).');
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

  try {
    authServerPort = await listenOnPort(server, AUTH_PORT);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EADDRINUSE') {
      throw error;
    }

    console.error(
      `Auth port ${AUTH_PORT} is already in use; using a free port instead.`
    );
    authServerPort = await listenOnPort(server, 0);
  }

  console.error(`Auth server running at http://localhost:${authServerPort}`);

  authServerInstance = server;
  return server;
}

export function openAuthWindow() {
  const url = `http://localhost:${getAuthServerPort()}/auth`;
  const cmd =
    process.platform === 'win32'
      ? `start ${url}`
      : process.platform === 'darwin'
        ? `open ${url}`
        : `xdg-open ${url}`;
  exec(cmd);
}
