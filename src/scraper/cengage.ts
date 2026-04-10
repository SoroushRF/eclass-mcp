import { chromium, type Browser, type Page } from 'playwright';
import {
  CengageAuthRequiredError,
  CengageNavigationError,
  CengageParseError,
} from './cengage-errors';
import {
  extractDashboardCourses,
  inferCourseFromCurrentPage,
  type CengageDashboardCourse,
} from './cengage-courses';
import {
  CENGAGE_SESSION_STALE_HOURS,
  getCengageSessionValidity,
} from './cengage-session';
import {
  ASSIGNMENT_CONTAINER_SELECTORS,
  ASSIGNMENT_DUE_DATE_SELECTORS,
  ASSIGNMENT_NAME_SELECTORS,
  ASSIGNMENT_ROW_SELECTORS,
  ASSIGNMENT_SCORE_SELECTORS,
  ASSIGNMENT_STATUS_SELECTORS,
  parseWebAssignAssignments,
  type CengageAssignmentRowCandidate,
} from './cengage-assignment-parser';
import { detectCengagePageState } from './cengage-state';
import { normalizeAndClassifyCengageEntry } from './cengage-url';

export interface WebAssignAssignment {
  name: string;
  dueDate: string;
  dueDateIso?: string;
  rawText?: string;
  score?: string;
  status: string;
  id?: string;
  courseId?: string;
  courseTitle?: string;
  url?: string;
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

  private async extractDashboardCourseInventory(
    page: Page
  ): Promise<CengageDashboardCourse[]> {
    const candidates = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href]')
      ).map((anchor) => {
        const href = anchor.getAttribute('href') || anchor.href || '';
        const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();

        return {
          href,
          text,
          titleAttr: (anchor.getAttribute('title') || '').trim(),
          ariaLabel: (anchor.getAttribute('aria-label') || '').trim(),
          dataCourseId: (
            anchor.getAttribute('data-course-id') ||
            anchor.getAttribute('data-courseid') ||
            ''
          ).trim(),
          dataCourseKey: (
            anchor.getAttribute('data-course-key') ||
            anchor.getAttribute('data-coursekey') ||
            ''
          ).trim(),
        };
      });
    });

    return extractDashboardCourses(candidates, page.url());
  }

  private async extractAssignmentRowCandidates(
    page: Page
  ): Promise<CengageAssignmentRowCandidate[]> {
    return page.evaluate(
      ({
        containerSelectors,
        rowSelectors,
        nameSelectors,
        dueDateSelectors,
        scoreSelectors,
        statusSelectors,
      }) => {
        const normalizeText = (value: string | null | undefined): string =>
          (value || '').replace(/\s+/g, ' ').trim();

        const isVisible = (element: Element): boolean => {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
          }

          const rect = htmlElement.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const uniqueElements = (elements: Element[]): Element[] => {
          const seen = new Set<Element>();
          const unique: Element[] = [];

          for (const element of elements) {
            if (!seen.has(element)) {
              seen.add(element);
              unique.push(element);
            }
          }

          return unique;
        };

        const containers: Element[] = [];
        for (const selector of containerSelectors) {
          for (const match of Array.from(document.querySelectorAll(selector))) {
            if (isVisible(match)) {
              containers.push(match);
            }
          }
        }

        if (containers.length === 0) {
          const headings = Array.from(
            document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')
          );

          for (const heading of headings) {
            const headingText = normalizeText(
              heading.textContent
            ).toLowerCase();
            if (!headingText.includes('assignment')) continue;

            const region = heading.closest('section, article, main, div');
            if (region && isVisible(region)) {
              containers.push(region);
            }
          }
        }

        const rows: CengageAssignmentRowCandidate[] = [];
        const uniqueContainers = uniqueElements(containers);

        for (const container of uniqueContainers) {
          const rowCandidates: Element[] = [];

          for (const selector of rowSelectors) {
            for (const row of Array.from(
              container.querySelectorAll(selector)
            )) {
              rowCandidates.push(row);
            }
          }

          const uniqueRows = uniqueElements(rowCandidates);

          for (const row of uniqueRows) {
            const rowText = normalizeText(row.textContent);
            if (!rowText || rowText.length < 12) continue;

            const lowerRowText = rowText.toLowerCase();
            const hasAssignmentSignals =
              lowerRowText.includes('due date') ||
              lowerRowText.includes('assignment') ||
              lowerRowText.includes('submitted') ||
              lowerRowText.includes('not submitted') ||
              lowerRowText.includes('past due') ||
              lowerRowText.includes('score') ||
              lowerRowText.includes('points') ||
              lowerRowText.includes('grade');

            if (!hasAssignmentSignals) continue;

            let name = '';
            for (const selector of nameSelectors) {
              const element = row.querySelector(selector);
              if (!element) continue;

              const value = normalizeText(element.textContent);
              if (value) {
                name = value;
                break;
              }
            }

            if (!name) {
              name = normalizeText(rowText.split(/due\s*date/i)[0]);
            }

            if (!name || name.toLowerCase() === 'due date') continue;

            let dueDate = '';
            for (const selector of dueDateSelectors) {
              const element = row.querySelector(selector);
              if (!element) continue;

              const value = normalizeText(element.textContent);
              if (value) {
                dueDate = value;
                break;
              }
            }

            let score = '';
            for (const selector of scoreSelectors) {
              const element = row.querySelector(selector);
              if (!element) continue;

              const value = normalizeText(element.textContent);
              if (value) {
                score = value;
                break;
              }
            }

            let statusHint = '';
            for (const selector of statusSelectors) {
              const element = row.querySelector(selector);
              if (!element) continue;

              const value = normalizeText(element.textContent);
              if (value) {
                statusHint = value;
                break;
              }
            }

            const link = row.querySelector<HTMLAnchorElement>('a[href]');
            const href = normalizeText(
              (link?.getAttribute('href') || link?.href || '').toString()
            );

            const assignmentId = normalizeText(
              row.getAttribute('data-assignment-id') ||
                row.getAttribute('data-id') ||
                row.id ||
                ''
            );

            rows.push({
              id: assignmentId || undefined,
              href: href || undefined,
              name,
              dueDate: dueDate || undefined,
              score: score || undefined,
              statusHint: statusHint || undefined,
              rowText,
            });
          }
        }

        return rows;
      },
      {
        containerSelectors: [...ASSIGNMENT_CONTAINER_SELECTORS],
        rowSelectors: [...ASSIGNMENT_ROW_SELECTORS],
        nameSelectors: [...ASSIGNMENT_NAME_SELECTORS],
        dueDateSelectors: [...ASSIGNMENT_DUE_DATE_SELECTORS],
        scoreSelectors: [...ASSIGNMENT_SCORE_SELECTORS],
        statusSelectors: [...ASSIGNMENT_STATUS_SELECTORS],
      }
    );
  }

  async listDashboardCourses(
    entryUrlInput: string
  ): Promise<CengageDashboardCourse[]> {
    const entry = normalizeAndClassifyCengageEntry(entryUrlInput);
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

      const state = await detectCengagePageState(page);
      if (state.state === 'login') {
        throw new CengageAuthRequiredError(
          'Cengage authentication is required before course discovery.',
          {
            entryUrl,
            linkType: entry.linkType,
            pageState: state,
          }
        );
      }

      const courses = await this.extractDashboardCourseInventory(page);
      if (courses.length > 0) {
        return courses;
      }

      if (state.state === 'course' || state.state === 'assignments') {
        const fallback = inferCourseFromCurrentPage(
          page.url(),
          await page.title()
        );
        if (fallback) {
          return [fallback];
        }
      }

      throw new CengageParseError(
        'No course links were discovered from the current Cengage/WebAssign page.',
        {
          entryUrl,
          linkType: entry.linkType,
          pageState: state,
        }
      );
    } finally {
      await context.close();
    }
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
          const dashboardCourses =
            await this.extractDashboardCourseInventory(page);

          throw new CengageNavigationError(
            dashboardCourses.length > 0
              ? 'Reached Cengage dashboard. A specific course selection is required before assignment extraction.'
              : 'Reached Cengage dashboard but no course links were detected.',
            {
              entryUrl,
              linkType: entry.linkType,
              pageState: currentState,
              courses: dashboardCourses,
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

      const rowCandidates = await this.extractAssignmentRowCandidates(page);
      if (!Array.isArray(rowCandidates)) {
        throw new CengageParseError(
          'Unexpected assignment extraction payload type.',
          {
            entryUrl,
            linkType: entry.linkType,
          }
        );
      }

      const inferredCourse = inferCourseFromCurrentPage(
        page.url(),
        await page.title()
      );

      return parseWebAssignAssignments(rowCandidates, {
        courseId: inferredCourse?.courseId,
        courseKey: inferredCourse?.courseKey,
        courseTitle: inferredCourse?.title,
      });
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
