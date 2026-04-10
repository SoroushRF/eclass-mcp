import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { loadSession } from '../session';
import { SessionExpiredError } from './types';

dotenv.config({ quiet: true });

const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';

export class EClassBrowserSession {
  private browser: Browser | null = null;

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
        ],
      });
    }
    return this.browser;
  }

  async getAuthenticatedContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const cookies = loadSession();
    if (!cookies || cookies.length === 0) {
      throw new SessionExpiredError();
    }

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-CA',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
    });

    await context.addCookies(cookies);
    return context;
  }

  async dumpPage(page: Page, name: string) {
    const debugDir = path.join(process.cwd(), '.eclass-mcp', 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    const html = await page.content();
    fs.writeFileSync(path.join(debugDir, `${name}.html`), html);
    console.error(`Dumped page to ${name}.html for debugging.`);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export { ECLASS_URL };
