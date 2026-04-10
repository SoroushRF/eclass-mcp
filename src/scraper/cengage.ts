import { chromium, type Browser } from 'playwright';
import {
  CengageAuthRequiredError,
  CengageNavigationError,
  CengageParseError,
} from './cengage-errors';
import {
  CENGAGE_SESSION_STALE_HOURS,
  getCengageSessionValidity,
} from './cengage-session';
import { detectCengagePageState } from './cengage-state';
import { normalizeAndClassifyCengageEntry } from './cengage-url';

export interface WebAssignAssignment {
  name: string;
  dueDate: string;
  score?: string;
  status: string;
  id?: string;
}

export class CengageScraper {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
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

  async getAssignments(ssoUrl: string): Promise<WebAssignAssignment[]> {
    const entry = normalizeAndClassifyCengageEntry(ssoUrl);
    const entryUrl = entry.normalizedUrl;

    const sessionValidity = getCengageSessionValidity();
    if (!sessionValidity.valid) {
      const message =
        sessionValidity.reason === 'stale'
          ? `Cengage session is stale (older than ${CENGAGE_SESSION_STALE_HOURS} hours). Please authenticate again.`
          : 'Cengage session state is missing or invalid. Please authenticate first.';

      throw new CengageAuthRequiredError(message, {
        entryUrl,
        linkType: entry.linkType,
        sessionReason: sessionValidity.reason,
        sessionSavedAt: sessionValidity.savedAt,
      });
    }

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      storageState: sessionValidity.statePath,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    try {
      console.error(`[Cengage] Navigating to SSO URL...`);
      try {
        await page.goto(entryUrl, { waitUntil: 'load', timeout: 45000 });
      } catch (error) {
        throw new CengageNavigationError(
          'Failed to open the provided Cengage/WebAssign URL.',
          {
            entryUrl,
            linkType: entry.linkType,
            cause: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }

      // Initial state snapshot gives deterministic context for auth/dashboard/course transitions.
      const initialState = await detectCengagePageState(page);
      if (initialState.state === 'login') {
        throw new CengageAuthRequiredError(
          'Cengage authentication is required before assignment extraction.',
          {
            entryUrl,
            linkType: entry.linkType,
            pageState: initialState,
          }
        );
      }

      // Wait for the specific WebAssign student home URL or dashboard indicators
      try {
        await page.waitForURL(
          /(.*webassign\.net\/web\/Student.*|.*webassign\.net\/v4cgi\/student.*)/i,
          {
            timeout: 30000,
          }
        );
      } catch (error) {
        const currentState = await detectCengagePageState(page);

        if (currentState.state === 'login') {
          throw new CengageAuthRequiredError(
            'Cengage authentication is required before assignment extraction.',
            {
              entryUrl,
              linkType: entry.linkType,
              pageState: currentState,
            }
          );
        }

        if (currentState.state === 'dashboard') {
          throw new CengageNavigationError(
            'Reached Cengage dashboard but no course was selected yet.',
            {
              entryUrl,
              linkType: entry.linkType,
              pageState: currentState,
              cause: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }

        throw new CengageNavigationError(
          'Could not reach a WebAssign student page from the provided URL.',
          {
            entryUrl,
            linkType: entry.linkType,
            pageState: currentState,
            cause: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }

      // Check if we need to click "Past Assignments" to see anything
      // (This is common if there are no current assignments)
      const hasAssignments = await page.isVisible(
        'button:has-text("Assignment")'
      );
      if (!hasAssignments) {
        console.error(
          `[Cengage] No current assignments visible, trying to reveal past assignments...`
        );
        try {
          // Try various selectors for the "Past Assignments" tab/button
          const selectors = [
            'button:has-text("Past Assignments")',
            'text="Past Assignments"',
            '.css-q10f9y button', // Generic button in assignment container
          ];

          for (const selector of selectors) {
            const btn = await page.$(selector);
            if (btn && (await btn.isVisible())) {
              await btn.click();
              console.error(
                `[Cengage] Clicked Past Assignments via: ${selector}`
              );
              break;
            }
          }
          // Wait for data to load after click
          await page.waitForTimeout(5000);
        } catch (_error) {
          console.error(
            `[Cengage] Warning: Could not toggle past assignments view.`
          );
        }
      }

      // Extraction logic
      const assignments = await page.evaluate(() => {
        const results: any[] = [];

        // Strategy 1: Data attributes (The most reliable for WebAssign React)
        const wrapper = document.querySelector(
          '#js-student-myAssignmentsWrapper'
        );
        if (wrapper) {
          // If it's the React version, sometimes the data is still in the attributes but rendered
          // We'll proceed with DOM scraping instead since we waited for rendering
        }

        // Strategy 2: List items / Rows
        // Standard WebAssign rows often have role="row" or specific classes
        const rows = document.querySelectorAll('li, tr, [role="row"]');
        rows.forEach((row) => {
          const text = row.textContent || '';
          if (text.toLowerCase().includes('due date')) {
            // Attempt to parse name and date
            // Name is usually the first link or bold text
            const nameEl = row.querySelector('a, b, strong, h3, h4');
            const name = nameEl?.textContent?.trim() || 'Unknown Assignment';

            // Clean up text for extraction
            const cleanText = text.replace(/\s+/g, ' ');

            // Regex for Due Date: Month Day, Year at Time
            const dateMatch = cleanText.match(
              /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+(st|nd|rd|th)?(,\s+\d{4})?/i
            );

            if (name && name !== 'Unknown Assignment') {
              results.push({
                name,
                dueDate: dateMatch ? dateMatch[0] : 'Unknown Date',
                status:
                  cleanText.includes('Submitted') || cleanText.includes('/')
                    ? 'Submitted'
                    : 'Pending',
                fullText: cleanText.slice(0, 200),
              });
            }
          }
        });

        return results;
      });

      if (!Array.isArray(assignments)) {
        throw new CengageParseError(
          'Unexpected assignment extraction payload type.',
          {
            entryUrl,
            linkType: entry.linkType,
          }
        );
      }

      // Filter duplicates by name
      const unique = Array.from(
        new Map(assignments.map((a) => [a.name, a])).values()
      );
      return unique;
    } finally {
      await context.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
