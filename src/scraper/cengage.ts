import { chromium, type Browser, type Page } from 'playwright';
import {
  CengageAuthRequiredError,
  CengageNavigationError,
  CengageParseError,
} from './cengage-errors';
import {
  extractDashboardCourses,
  extractDashboardCoursesFromCardCandidates,
  inferCourseFromCurrentPage,
  type CengageDashboardCardCandidate,
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
import {
  normalizeAndClassifyCengageEntry,
  type CengageEntryLinkType,
} from './cengage-url';

const CENGAGE_CANONICAL_HOME_URLS: readonly string[] = [
  'https://www.cengage.ca/dashboard/home',
  'https://www.cengage.com/dashboard/home',
  'https://www.webassign.net/web/Student/Home.html',
  'https://www.webassign.net/v4cgi/student',
  'https://login.cengage.com/',
];

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
    const cardCandidates: CengageDashboardCardCandidate[] = await page.evaluate(
      () => {
        const normalizeText = (value: string | null | undefined): string =>
          (value || '').replace(/\s+/g, ' ').trim();

        const launchSelectorPriority = [
          'a.home-page-launch-course-link[href]',
          'a[data-test="home-page-launch-course-link"][href]',
          'a[data-test*="home-page-launch-course-link"][href]',
          'a[class*="home-page-launch-course-link"][href]',
        ];

        const fallbackLaunchPattern =
          /webassign|coursekey|mindtap|nglms|dashboard\/course|\/course\//i;

        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[id^="home-page-entitlement-card-"], [data-test*="home-page-entitlement-card"], [class*="home-page-entitlement-card"]'
          )
        );

        const seen = new Set<HTMLElement>();
        const uniqueCards = cards.filter((card) => {
          if (seen.has(card)) {
            return false;
          }

          seen.add(card);
          return true;
        });

        const results: CengageDashboardCardCandidate[] = [];

        for (const card of uniqueCards) {
          let launchAnchor: HTMLAnchorElement | null = null;

          for (const selector of launchSelectorPriority) {
            const matched = card.querySelector<HTMLAnchorElement>(selector);
            if (matched) {
              launchAnchor = matched;
              break;
            }
          }

          if (!launchAnchor) {
            launchAnchor =
              Array.from(
                card.querySelectorAll<HTMLAnchorElement>('a[href]')
              ).find((anchor) => {
                const href = anchor.getAttribute('href') || anchor.href || '';
                const text = normalizeText(anchor.textContent);
                const title = normalizeText(anchor.getAttribute('title'));
                const ariaLabel = normalizeText(
                  anchor.getAttribute('aria-label')
                );
                const haystack = `${href} ${text} ${title} ${ariaLabel}`;
                return fallbackLaunchPattern.test(haystack);
              }) || null;
          }

          if (!launchAnchor) {
            continue;
          }

          const launchHref =
            launchAnchor.getAttribute('href') || launchAnchor.href || '';
          if (!normalizeText(launchHref)) {
            continue;
          }

          const titleElement = card.querySelector<HTMLElement>(
            '[data-test="home-page-title"], [data-test*="home-page-title"], .home-page-title, [class*="home-page-title"], h2, h3, [role="heading"]'
          );

          results.push({
            cardId:
              normalizeText(card.id) ||
              normalizeText(card.getAttribute('data-test')),
            cardTitle:
              normalizeText(titleElement?.textContent) ||
              normalizeText(card.getAttribute('data-course-title')),
            launchHref,
            launchText: normalizeText(launchAnchor.textContent),
            launchTitleAttr: normalizeText(launchAnchor.getAttribute('title')),
            launchAriaLabel: normalizeText(
              launchAnchor.getAttribute('aria-label')
            ),
            dataCourseId:
              normalizeText(
                launchAnchor.getAttribute('data-course-id') ||
                  launchAnchor.getAttribute('data-courseid')
              ) ||
              normalizeText(card.getAttribute('data-course-id')) ||
              normalizeText(card.getAttribute('data-courseid')),
            dataCourseKey:
              normalizeText(
                launchAnchor.getAttribute('data-course-key') ||
                  launchAnchor.getAttribute('data-coursekey')
              ) ||
              normalizeText(card.getAttribute('data-course-key')) ||
              normalizeText(card.getAttribute('data-coursekey')),
          });
        }

        return results;
      }
    );

    const cardCourses = extractDashboardCoursesFromCardCandidates(
      cardCandidates,
      page.url()
    );
    if (cardCourses.length > 0) {
      return cardCourses;
    }

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

  private async discoverCoursesFromCurrentPage(
    page: Page,
    context: {
      entryUrl: string;
      linkType: CengageEntryLinkType;
      allowSyntheticFallback?: boolean;
    }
  ): Promise<CengageDashboardCourse[]> {
    const state = await detectCengagePageState(page);
    if (state.state === 'login') {
      throw new CengageAuthRequiredError(
        'Cengage authentication is required before course discovery.',
        {
          entryUrl: context.entryUrl,
          linkType: context.linkType,
          pageState: state,
        }
      );
    }

    const courses = await this.extractDashboardCourseInventory(page);
    if (courses.length > 0) {
      return courses;
    }

    if (
      context.allowSyntheticFallback &&
      (state.state === 'course' || state.state === 'assignments')
    ) {
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
        entryUrl: context.entryUrl,
        linkType: context.linkType,
        pageState: state,
      }
    );
  }

  private async discoverCoursesViaCanonicalBootstrap(
    page: Page
  ): Promise<CengageDashboardCourse[]> {
    let lastRecoverableError:
      | CengageNavigationError
      | CengageParseError
      | null = null;

    for (const entryUrl of CENGAGE_CANONICAL_HOME_URLS) {
      try {
        await page.goto(entryUrl, { waitUntil: 'load', timeout: 45000 });
      } catch (error) {
        lastRecoverableError = new CengageNavigationError(
          'Failed to open canonical Cengage/WebAssign bootstrap URL.',
          {
            entryUrl,
            linkType: 'cengage_dashboard',
            cause: error instanceof Error ? error.message : 'Unknown error',
          }
        );
        continue;
      }

      try {
        return await this.discoverCoursesFromCurrentPage(page, {
          entryUrl,
          linkType: 'cengage_dashboard',
          allowSyntheticFallback: true,
        });
      } catch (error) {
        if (error instanceof CengageAuthRequiredError) {
          throw error;
        }

        if (
          error instanceof CengageNavigationError ||
          error instanceof CengageParseError
        ) {
          lastRecoverableError = error;
          continue;
        }

        throw error;
      }
    }

    if (lastRecoverableError) {
      throw lastRecoverableError;
    }

    throw new CengageParseError(
      'No courses were discovered after trying canonical Cengage/WebAssign homes.',
      {
        attemptedEntries: [...CENGAGE_CANONICAL_HOME_URLS],
      }
    );
  }

  private getValidSessionStatePathOrThrow(
    entryUrl: string,
    linkType: CengageEntryLinkType
  ): string {
    const sessionValidity = getCengageSessionValidity();
    if (!sessionValidity.valid) {
      const message =
        sessionValidity.reason === 'stale'
          ? `Cengage session is stale (older than ${CENGAGE_SESSION_STALE_HOURS} hours). Please authenticate again.`
          : 'Cengage session state is missing or invalid. Please authenticate first.';

      throw new CengageAuthRequiredError(message, {
        entryUrl,
        linkType,
        sessionReason: sessionValidity.reason,
        sessionSavedAt: sessionValidity.savedAt,
      });
    }

    return sessionValidity.statePath;
  }

  private async withAuthenticatedPage<T>(
    entryUrl: string,
    linkType: CengageEntryLinkType,
    callback: (page: Page) => Promise<T>
  ): Promise<T> {
    const storageState = this.getValidSessionStatePathOrThrow(
      entryUrl,
      linkType
    );
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      storageState,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    try {
      return await callback(page);
    } finally {
      await context.close();
    }
  }

  async listDashboardCoursesFromSavedSession(): Promise<
    CengageDashboardCourse[]
  > {
    const entryUrl = CENGAGE_CANONICAL_HOME_URLS[0];
    return this.withAuthenticatedPage(
      entryUrl,
      'cengage_dashboard',
      async (page) => this.discoverCoursesViaCanonicalBootstrap(page)
    );
  }

  async listDashboardCoursesFromEntryLink(
    entryUrlInput: string
  ): Promise<CengageDashboardCourse[]> {
    const entry = normalizeAndClassifyCengageEntry(entryUrlInput);
    const entryUrl = entry.normalizedUrl;
    const linkType = entry.linkType;

    return this.withAuthenticatedPage(entryUrl, linkType, async (page) => {
      try {
        await page.goto(entryUrl, {
          waitUntil: 'load',
          timeout: 45000,
        });
      } catch (error) {
        throw new CengageNavigationError(
          'Failed to open the provided Cengage/WebAssign URL.',
          {
            entryUrl,
            linkType,
            cause: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }

      return this.discoverCoursesFromCurrentPage(page, {
        entryUrl,
        linkType,
        allowSyntheticFallback: true,
      });
    });
  }

  async listDashboardCourses(
    entryUrlInput?: string
  ): Promise<CengageDashboardCourse[]> {
    const hasExplicitEntry =
      typeof entryUrlInput === 'string' && entryUrlInput.trim().length > 0;
    if (!hasExplicitEntry) {
      return this.listDashboardCoursesFromSavedSession();
    }

    return this.listDashboardCoursesFromEntryLink(entryUrlInput as string);
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
