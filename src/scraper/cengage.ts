import { chromium, type Browser, type Page } from 'playwright';
import {
  CengageAuthRequiredError,
  CengageNavigationError,
  CengageParseError,
} from './cengage-errors';
import {
  inferCourseFromCurrentPage,
  type CengageDashboardCourse,
} from './cengage-courses';
import { parseWebAssignAssignments } from './cengage-assignment-parser';
import { extractAssignmentRowCandidates } from './cengage-assignments';
import { extractDashboardCourseInventory } from './cengage-dashboard-inventory';
import {
  getValidSessionStatePathOrThrow,
  withAuthenticatedPage,
} from './cengage-navigation';
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

    const courses = await extractDashboardCourseInventory(page);
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
          allowSyntheticFallback: false,
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

  async listDashboardCoursesFromSavedSession(): Promise<
    CengageDashboardCourse[]
  > {
    const entryUrl = CENGAGE_CANONICAL_HOME_URLS[0];
    return withAuthenticatedPage({
      entryUrl,
      linkType: 'cengage_dashboard',
      getBrowser: () => this.getBrowser(),
      callback: async (page) => this.discoverCoursesViaCanonicalBootstrap(page),
    });
  }

  async listDashboardCoursesFromEntryLink(
    entryUrlInput: string
  ): Promise<CengageDashboardCourse[]> {
    const entry = normalizeAndClassifyCengageEntry(entryUrlInput);
    const entryUrl = entry.normalizedUrl;
    const linkType = entry.linkType;

    return withAuthenticatedPage({
      entryUrl,
      linkType,
      getBrowser: () => this.getBrowser(),
      callback: async (page) => {
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
      },
    });
  }

  async getAssignments(ssoUrl: string): Promise<WebAssignAssignment[]> {
    const entry = normalizeAndClassifyCengageEntry(ssoUrl);
    const entryUrl = entry.normalizedUrl;

    const storageState = getValidSessionStatePathOrThrow(
      entryUrl,
      entry.linkType
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
          const dashboardCourses = await extractDashboardCourseInventory(page);

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

      const rowCandidates = await extractAssignmentRowCandidates(page);
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
