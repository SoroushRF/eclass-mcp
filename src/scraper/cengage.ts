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
import {
  parseWebAssignAssignments,
  type CengageAssignmentRowCandidate,
} from './cengage-assignment-parser';
import {
  captureAssignmentRenderedMedia,
  extractAssignmentDetails,
  type ExtractAssignmentDetailsOptions,
  type ExtractedAssignmentDetails,
} from './cengage/assignment-details';
import { extractAssignmentRowCandidates } from './cengage/assignments';
import { extractDashboardCourseInventory } from './cengage/dashboard-inventory';
import {
  getValidSessionStatePathOrThrow,
  withAuthenticatedPage,
} from './cengage/navigation';
import { waitForCengagePageState } from './cengage-state';
import {
  normalizeAndClassifyCengageEntry,
  type CengageEntryLinkType,
} from './cengage-url';

// Canonical homes are attempted in order when bootstrapping from a saved session.
const CENGAGE_CANONICAL_HOME_URLS: readonly string[] = [
  'https://www.cengage.ca/dashboard/home',
  'https://www.cengage.com/dashboard/home',
  'https://www.webassign.net/web/Student/Home.html',
  'https://www.webassign.net/v4cgi/student',
  'https://login.cengage.com/',
];

const ASSIGNMENT_TAB_SELECTOR_GROUPS = [
  {
    label: 'Past Assignments',
    selectors: [
      'button[data-analytics="past-assignments-tab"]',
      '[role="tab"][data-analytics="past-assignments-tab"]',
      '[role="tab"][aria-label*="Past Assignments"]',
      'button[aria-label*="Past Assignments"]',
      '[role="tab"]:has-text("Past Assignments")',
      'button:has-text("Past Assignments")',
    ],
  },
  {
    label: 'All Assignments',
    selectors: [
      'button[data-analytics="all-assignments-tab"]',
      '[role="tab"][data-analytics="all-assignments-tab"]',
      '[role="tab"][aria-label*="All Assignments"]',
      'button[aria-label*="All Assignments"]',
      '[role="tab"]:has-text("All Assignments")',
      'button:has-text("All Assignments")',
    ],
  },
] as const;

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

export interface GetWebAssignAssignmentDetailsOptions extends ExtractAssignmentDetailsOptions {
  assignmentUrl?: string;
  assignmentId?: string;
  assignmentQuery?: string;
  includeRenderedMedia?: boolean;
  maxRenderedImages?: number;
  maxCaptureUnits?: number;
  maxCapturePerQuestion?: number;
  maxMediaPayloadBytes?: number;
  minTextForSafeText?: number;
  captureDpi?: number;
}

export interface WebAssignAssignmentSelection {
  assignmentId?: string;
  name: string;
  dueDate?: string;
  dueDateIso?: string;
  status: 'pending' | 'submitted' | 'graded' | 'unknown';
  score?: string;
  url?: string;
}

export interface WebAssignAssignmentDetailsResult {
  selectedAssignment: WebAssignAssignmentSelection;
  availableAssignments: WebAssignAssignmentSelection[];
  details: ExtractedAssignmentDetails;
  selectionMessage?: string;
}

function normalizeComparableText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeAssignmentStatus(
  value: string | undefined
): 'pending' | 'submitted' | 'graded' | 'unknown' {
  const normalized = normalizeComparableText(value);
  if (!normalized) return 'unknown';
  if (normalized.includes('submitted')) return 'submitted';
  if (normalized.includes('graded')) return 'graded';
  if (normalized.includes('pending')) return 'pending';
  return 'unknown';
}

function mapAssignmentSelection(
  assignment: WebAssignAssignment
): WebAssignAssignmentSelection {
  return {
    assignmentId: assignment.id,
    name: assignment.name,
    dueDate: assignment.dueDate,
    dueDateIso: assignment.dueDateIso,
    status: normalizeAssignmentStatus(assignment.status),
    score: assignment.score,
    url: assignment.url,
  };
}

function normalizeComparableUrl(value: string, baseUrl?: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';

  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    url.hash = '';
    return `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function resolveAbsoluteUrl(
  value: string | undefined,
  baseUrl: string
): string {
  const raw = (value || '').trim();
  if (!raw) return '';

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return '';
  }
}

function assignmentMatchesById(
  assignment: WebAssignAssignment,
  assignmentId: string
): boolean {
  const normalizedId = normalizeComparableText(assignmentId);
  if (!normalizedId) return false;

  if (normalizeComparableText(assignment.id) === normalizedId) {
    return true;
  }

  if (!assignment.url) {
    return false;
  }

  const urlToken = normalizeComparableText(assignment.url);
  return (
    urlToken.includes(`dep=${normalizedId}`) ||
    urlToken.endsWith(`/${normalizedId}`) ||
    urlToken.includes(`assignmentid=${normalizedId}`)
  );
}

interface AssignmentSelectionResolution {
  selected?: WebAssignAssignment;
  message?: string;
}

function resolveAssignmentSelection(params: {
  assignments: WebAssignAssignment[];
  baseUrl: string;
  assignmentUrl?: string;
  assignmentId?: string;
  assignmentQuery?: string;
}): AssignmentSelectionResolution {
  const { assignments, baseUrl, assignmentUrl, assignmentId, assignmentQuery } =
    params;

  if (assignments.length === 0) {
    return {
      message:
        'No assignments were available to select from the current course context.',
    };
  }

  const normalizedTargetUrl = assignmentUrl
    ? normalizeComparableUrl(assignmentUrl, baseUrl)
    : '';

  if (normalizedTargetUrl) {
    const matched = assignments.find((assignment) => {
      const candidate = normalizeComparableUrl(assignment.url || '', baseUrl);
      return candidate === normalizedTargetUrl;
    });

    if (matched) {
      return { selected: matched };
    }

    return {
      message:
        'No assignment matched assignmentUrl. Confirm the URL comes from get_cengage_assignments output for the same course.',
    };
  }

  const normalizedTargetId = normalizeComparableText(assignmentId);
  if (normalizedTargetId) {
    const matched = assignments.find((assignment) =>
      assignmentMatchesById(assignment, normalizedTargetId)
    );

    if (matched) {
      return { selected: matched };
    }

    return {
      message:
        'No assignment matched assignmentId. Confirm the id comes from get_cengage_assignments output for the same course.',
    };
  }

  const normalizedQuery = normalizeComparableText(assignmentQuery);
  if (normalizedQuery) {
    const exactMatches = assignments.filter(
      (assignment) =>
        normalizeComparableText(assignment.name) === normalizedQuery
    );

    if (exactMatches.length === 1) {
      return { selected: exactMatches[0] };
    }

    if (exactMatches.length > 1) {
      return {
        selected: exactMatches[0],
        message:
          'Multiple assignments matched assignmentQuery exactly; selected the first exact match.',
      };
    }

    const partialMatches = assignments.filter((assignment) =>
      normalizeComparableText(assignment.name).includes(normalizedQuery)
    );

    if (partialMatches.length === 1) {
      return { selected: partialMatches[0] };
    }

    if (partialMatches.length > 1) {
      return {
        selected: partialMatches[0],
        message:
          'Multiple assignments matched assignmentQuery; selected the first partial match.',
      };
    }

    return {
      message:
        'No assignment matched assignmentQuery. Try a more specific assignment name.',
    };
  }

  return {
    selected: assignments[0],
    message:
      'No explicit assignment selector provided. Defaulted to the first assignment returned for this course.',
  };
}

export class CengageScraper {
  private browser: Browser | null = null;

  private async collectAssignmentRowsWithTabFallback(
    page: Page
  ): Promise<CengageAssignmentRowCandidate[]> {
    let rowCandidates = await extractAssignmentRowCandidates(page);
    if (rowCandidates.length > 0) {
      return rowCandidates;
    }

    for (const tabGroup of ASSIGNMENT_TAB_SELECTOR_GROUPS) {
      let matchedSelector: string | null = null;
      let clicked = false;

      for (const selector of tabGroup.selectors) {
        const locator = page.locator(selector).first();
        const count = await locator.count();
        if (count === 0) {
          continue;
        }

        const visible = await locator.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        matchedSelector = selector;

        const ariaSelected = (
          (await locator.getAttribute('aria-selected')) || ''
        ).toLowerCase();

        if (ariaSelected !== 'true') {
          const enabled = await locator.isEnabled().catch(() => true);
          if (!enabled) {
            matchedSelector = null;
            continue;
          }

          await locator.click({ timeout: 2500 });
          clicked = true;
        }

        break;
      }

      if (!matchedSelector) {
        continue;
      }

      if (clicked) {
        console.error(
          `[Cengage] Switched assignment tab to "${tabGroup.label}" via: ${matchedSelector}`
        );
      } else {
        console.error(
          `[Cengage] "${tabGroup.label}" tab already selected via: ${matchedSelector}`
        );
      }

      await page
        .waitForLoadState('networkidle', { timeout: 3000 })
        .catch(() => null);
      await page.waitForTimeout(clicked ? 1500 : 800);

      rowCandidates = await extractAssignmentRowCandidates(page);
      if (rowCandidates.length > 0) {
        console.error(
          `[Cengage] Found ${rowCandidates.length} assignment rows after checking "${tabGroup.label}" tab.`
        );
        return rowCandidates;
      }
    }

    return rowCandidates;
  }

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
    const state = await waitForCengagePageState(page, {
      timeoutMs: 9000,
      pollIntervalMs: 300,
      stableReadings: 1,
    });
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
      (state.state === 'student_home' ||
        state.state === 'course' ||
        state.state === 'assignments')
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
      const initialState = await waitForCengagePageState(page, {
        timeoutMs: 10000,
        pollIntervalMs: 300,
        stableReadings: 1,
      });
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
      let continueAfterStateFallback = false;
      try {
        await page.waitForURL(
          /(.*webassign\.net\/web\/Student.*|.*webassign\.net\/v4cgi\/student.*)/i,
          {
            timeout: 30000,
          }
        );
      } catch (error) {
        const currentState = await waitForCengagePageState(page, {
          timeoutMs: 7000,
          pollIntervalMs: 300,
          stableReadings: 1,
        });

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

        if (
          currentState.state === 'assignments' ||
          currentState.state === 'student_home' ||
          currentState.state === 'course'
        ) {
          continueAfterStateFallback = true;
        }

        if (continueAfterStateFallback) {
          console.error(
            `[Cengage] waitForURL timeout recovered via state detection: ${currentState.state}`
          );
        }

        if (!continueAfterStateFallback) {
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
      }

      const rowCandidates =
        await this.collectAssignmentRowsWithTabFallback(page);
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

  async getAssignmentDetails(
    ssoUrl: string,
    options: GetWebAssignAssignmentDetailsOptions = {}
  ): Promise<WebAssignAssignmentDetailsResult> {
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
      console.error(`[Cengage] Navigating to assignment source URL...`);
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

      const initialState = await waitForCengagePageState(page, {
        timeoutMs: 10000,
        pollIntervalMs: 300,
        stableReadings: 1,
      });
      if (initialState.state === 'login') {
        throw new CengageAuthRequiredError(
          'Cengage authentication is required before assignment detail extraction.',
          {
            entryUrl,
            linkType: entry.linkType,
            pageState: initialState,
          }
        );
      }

      let continueAfterStateFallback = false;
      try {
        await page.waitForURL(
          /(.*webassign\.net\/web\/Student.*|.*webassign\.net\/v4cgi\/student.*)/i,
          {
            timeout: 30000,
          }
        );
      } catch (error) {
        const currentState = await waitForCengagePageState(page, {
          timeoutMs: 7000,
          pollIntervalMs: 300,
          stableReadings: 1,
        });

        if (currentState.state === 'login') {
          throw new CengageAuthRequiredError(
            'Cengage authentication is required before assignment detail extraction.',
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
              ? 'Reached Cengage dashboard. A specific course selection is required before assignment detail extraction.'
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

        if (
          currentState.state === 'assignments' ||
          currentState.state === 'student_home' ||
          currentState.state === 'course'
        ) {
          continueAfterStateFallback = true;
        }

        if (continueAfterStateFallback) {
          console.error(
            `[Cengage] waitForURL timeout recovered via state detection: ${currentState.state}`
          );
        }

        if (!continueAfterStateFallback) {
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
      }

      const rowCandidates =
        await this.collectAssignmentRowsWithTabFallback(page);
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

      const assignments = parseWebAssignAssignments(rowCandidates, {
        courseId: inferredCourse?.courseId,
        courseKey: inferredCourse?.courseKey,
        courseTitle: inferredCourse?.title,
      });

      if (assignments.length === 0) {
        throw new CengageParseError(
          'No assignments were found while preparing assignment detail extraction.',
          {
            entryUrl,
            linkType: entry.linkType,
          }
        );
      }

      const selection = resolveAssignmentSelection({
        assignments,
        baseUrl: page.url(),
        assignmentUrl: options.assignmentUrl,
        assignmentId: options.assignmentId,
        assignmentQuery: options.assignmentQuery,
      });

      if (!selection.selected) {
        throw new CengageParseError(
          selection.message ||
            'Could not select a target assignment for detail extraction.',
          {
            entryUrl,
            linkType: entry.linkType,
            assignmentUrl: options.assignmentUrl,
            assignmentId: options.assignmentId,
            assignmentQuery: options.assignmentQuery,
            availableAssignments: assignments
              .slice(0, 25)
              .map(mapAssignmentSelection),
          }
        );
      }

      const selectedAssignment = selection.selected;
      const targetAssignmentUrl = resolveAbsoluteUrl(
        selectedAssignment.url,
        page.url()
      );

      if (!targetAssignmentUrl) {
        throw new CengageParseError(
          'Selected assignment does not include a navigable URL.',
          {
            entryUrl,
            linkType: entry.linkType,
            selectedAssignment: mapAssignmentSelection(selectedAssignment),
          }
        );
      }

      try {
        await page.goto(targetAssignmentUrl, {
          waitUntil: 'load',
          timeout: 45000,
        });
      } catch (error) {
        throw new CengageNavigationError(
          'Failed to open the selected WebAssign assignment page.',
          {
            entryUrl,
            linkType: entry.linkType,
            targetAssignmentUrl,
            selectedAssignment: mapAssignmentSelection(selectedAssignment),
            cause: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }

      const detailState = await waitForCengagePageState(page, {
        timeoutMs: 9000,
        pollIntervalMs: 300,
        stableReadings: 1,
      });

      if (detailState.state === 'login') {
        throw new CengageAuthRequiredError(
          'Cengage authentication expired while opening assignment details.',
          {
            entryUrl,
            linkType: entry.linkType,
            targetAssignmentUrl,
            pageState: detailState,
          }
        );
      }

      await page
        .waitForSelector(
          'div.waQBox[id^="question"], .js-question-header, [data-test^="questionHeader"]',
          { timeout: 15000 }
        )
        .catch(() => null);

      const details = await extractAssignmentDetails(page, {
        maxQuestions: options.maxQuestions,
        maxQuestionTextChars: options.maxQuestionTextChars,
        maxAnswerTextChars: options.maxAnswerTextChars,
        includeAnswers: options.includeAnswers,
        includeResources: options.includeResources,
        includeAssetInventory: options.includeAssetInventory,
        maxInteractiveAssets: options.maxInteractiveAssets,
        maxMediaAssets: options.maxMediaAssets,
      });

      if (options.includeRenderedMedia !== false) {
        await captureAssignmentRenderedMedia(page, details, {
          maxRenderedImages: options.maxRenderedImages,
          maxCaptureUnits: options.maxCaptureUnits,
          maxCapturePerQuestion: options.maxCapturePerQuestion,
          maxPayloadBytes: options.maxMediaPayloadBytes,
          minTextForSafeText: options.minTextForSafeText,
          captureDpi: options.captureDpi,
        });
      }

      return {
        selectedAssignment: mapAssignmentSelection(selectedAssignment),
        availableAssignments: assignments.map(mapAssignmentSelection),
        details,
        ...(selection.message ? { selectionMessage: selection.message } : {}),
      };
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
