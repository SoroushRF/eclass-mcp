import { chromium, type Browser, type Locator, type Page } from 'playwright';
import {
  CengageAuthRequiredError,
  CengageCourseActivationError,
  CengageInvalidInputError,
  CengageNavigationError,
  CengageParseError,
} from './cengage-errors';
import { ValidationError } from '../errors/validation-error';
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
import {
  collectWebAssignCourseContext,
  verifyWebAssignCourseContext,
  type WebAssignCourseContext,
} from './cengage/course-context';
import { getLogger } from '../logging/context';
import { getSelectorGroup, logDomSelectorMatch } from './selectors';
import {
  isAllowedUrlForPolicy,
  validateFinalUrlForPolicy,
  validateUrlForPolicy,
} from '../security/url-policy';

// Canonical homes are attempted in order when bootstrapping from a saved session.
const CENGAGE_CANONICAL_HOME_URLS: readonly string[] = [
  'https://www.cengage.ca/dashboard/home',
  'https://www.cengage.com/dashboard/home',
  'https://www.webassign.net/web/Student/Home.html',
  'https://www.webassign.net/v4cgi/student',
  'https://login.cengage.com/',
];

const activeCengageScrapers = new Set<CengageScraper>();

export async function closeActiveCengageScrapers(): Promise<void> {
  const scrapers = Array.from(activeCengageScrapers);
  await Promise.allSettled(scrapers.map((scraper) => scraper.close()));
}

function validateCengageFinalUrl(url: string, message: string): string {
  try {
    return validateFinalUrlForPolicy(url, 'cengage_page');
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new CengageNavigationError(message, error.details);
    }
    throw error;
  }
}

function validateCengagePageTargetUrl(url: string): string {
  try {
    return validateUrlForPolicy(url, 'cengage_page');
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new CengageInvalidInputError(
        'Cengage/WebAssign target URL is not allowed.',
        error.details
      );
    }
    throw error;
  }
}

const ASSIGNMENT_TAB_SELECTOR_GROUPS = [
  'Past Assignments',
  'All Assignments',
].map((label) => ({
  label,
  candidates: getSelectorGroup('cengage.assignments.tabs').candidates.filter(
    (candidate) => candidate.description === label
  ),
}));

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

export interface WebAssignAssignmentsResult {
  assignments: WebAssignAssignment[];
  context: WebAssignCourseContext;
}

export interface GetWebAssignAssignmentsOptions {
  expectedCourse?: CengageDashboardCourse;
  expectedCourseTitle?: string;
  expectedCourseCode?: string;
}

export interface GetWebAssignAssignmentDetailsOptions extends ExtractAssignmentDetailsOptions {
  expectedCourse?: CengageDashboardCourse;
  expectedCourseTitle?: string;
  expectedCourseCode?: string;
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

export function normalizeComparableText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function normalizeAssignmentStatus(
  value: string | undefined
): 'pending' | 'submitted' | 'graded' | 'unknown' {
  const normalized = normalizeComparableText(value);
  if (!normalized) return 'unknown';
  if (normalized.includes('submitted')) return 'submitted';
  if (normalized.includes('graded')) return 'graded';
  if (normalized.includes('pending')) return 'pending';
  return 'unknown';
}

export function mapAssignmentSelection(
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

export function normalizeComparableUrl(
  value: string,
  baseUrl?: string
): string {
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

export function resolveAbsoluteUrl(
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

export function assignmentMatchesById(
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

export interface AssignmentSelectionResolution {
  selected?: WebAssignAssignment;
  message?: string;
}

export function resolveAssignmentSelection(params: {
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

  constructor() {
    activeCengageScrapers.add(this);
  }

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

      for (const candidate of tabGroup.candidates) {
        const locator = page.locator(candidate.selector).first();
        const count = await locator.count();
        if (count === 0) {
          continue;
        }

        const visible = await locator.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        matchedSelector = candidate.selector;
        logDomSelectorMatch({
          pageType: 'cengage.assignments',
          groupId: 'cengage.assignments.tabs',
          candidateId: candidate.id,
          selector: candidate.selector,
          matchCount: count,
          url: page.url(),
        });

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
        getLogger().debug({
          event: 'cengage_assignment_tab_switched',
          tab: tabGroup.label,
          selector: matchedSelector,
        });
      } else {
        getLogger().debug({
          event: 'cengage_assignment_tab_already_selected',
          tab: tabGroup.label,
          selector: matchedSelector,
        });
      }

      await page
        .waitForLoadState('networkidle', { timeout: 3000 })
        .catch(() => null);
      await page.waitForTimeout(clicked ? 1500 : 800);

      rowCandidates = await extractAssignmentRowCandidates(page);
      if (rowCandidates.length > 0) {
        getLogger().debug({
          event: 'cengage_assignment_rows_after_tab',
          tab: tabGroup.label,
          rowCount: rowCandidates.length,
        });
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

  private selectorLiteral(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private async revealWebAssignCourseMenu(page: Page): Promise<void> {
    const selectors = [
      'button[aria-label="COURSES"]',
      'button[aria-label*="COURSES"]',
      'button:has-text("COURSES")',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (count === 0) continue;

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      await locator.click({ timeout: 3000 }).catch(() => null);
      await page.waitForTimeout(500).catch(() => null);
      return;
    }
  }

  private assertExpectedCourseContext(
    context: WebAssignCourseContext,
    options: GetWebAssignAssignmentsOptions
  ): void {
    if (!options.expectedCourse) return;

    const verification = verifyWebAssignCourseContext({
      expectedCourse: options.expectedCourse,
      expectedCourseTitle: options.expectedCourseTitle,
      expectedCourseCode: options.expectedCourseCode,
      actual: context,
    });

    if (verification.ok) return;

    throw new CengageCourseActivationError(
      'WebAssign opened a different active course than the selected Cengage course.',
      {
        ...verification.diagnostics,
        actualCourseTitle: context.currentCourseTitle || context.pageTitle,
        actualCourseId: context.currentSelected,
        actualCurrentSelected: context.currentSelected,
        actualPageUrl: context.pageUrl,
        actualPageTitle: context.pageTitle,
      }
    );
  }

  private async waitForAssignmentSourceUrl(
    page: Page,
    context: {
      entryUrl: string;
      linkType: CengageEntryLinkType;
      authMessage: string;
      dashboardMessage: string;
    }
  ): Promise<void> {
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
        throw new CengageAuthRequiredError(context.authMessage, {
          entryUrl: context.entryUrl,
          linkType: context.linkType,
          pageState: currentState,
        });
      }

      if (currentState.state === 'dashboard') {
        const dashboardCourses = await extractDashboardCourseInventory(page);

        throw new CengageNavigationError(
          dashboardCourses.length > 0
            ? context.dashboardMessage
            : 'Reached Cengage dashboard but no course links were detected.',
          {
            entryUrl: context.entryUrl,
            linkType: context.linkType,
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
            entryUrl: context.entryUrl,
            linkType: context.linkType,
            pageState: currentState,
            cause: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
    }
  }

  private async extractAssignmentsFromPage(
    page: Page,
    context: {
      entryUrl: string;
      linkType: CengageEntryLinkType;
      options?: GetWebAssignAssignmentsOptions;
    }
  ): Promise<WebAssignAssignmentsResult> {
    await this.revealWebAssignCourseMenu(page);
    const activeCourseContext = await collectWebAssignCourseContext(page);
    this.assertExpectedCourseContext(
      activeCourseContext,
      context.options || {}
    );

    const rowCandidates = await this.collectAssignmentRowsWithTabFallback(page);
    if (!Array.isArray(rowCandidates)) {
      throw new CengageParseError(
        'Unexpected assignment extraction payload type.',
        {
          entryUrl: context.entryUrl,
          linkType: context.linkType,
        }
      );
    }

    const inferredCourse = inferCourseFromCurrentPage(
      page.url(),
      activeCourseContext.currentCourseTitle || (await page.title())
    );

    return {
      context: activeCourseContext,
      assignments: parseWebAssignAssignments(rowCandidates, {
        courseId:
          activeCourseContext.currentSelected || inferredCourse?.courseId,
        courseKey: inferredCourse?.courseKey,
        courseTitle:
          activeCourseContext.currentCourseTitle || inferredCourse?.title,
      }),
    };
  }

  private async activateLink(page: Page, locator: Locator): Promise<Page> {
    const popupPromise = page
      .context()
      .waitForEvent('page', { timeout: 10000 })
      .catch(() => null);
    const href = await locator.getAttribute('href').catch(() => null);

    await locator.click({ timeout: 10000 });
    const popup = await popupPromise;
    const targetPage = popup || page;
    await targetPage
      .waitForLoadState('domcontentloaded', { timeout: 45000 })
      .catch(() => null);
    if (targetPage.url() !== 'about:blank') {
      validateCengageFinalUrl(
        targetPage.url(),
        'Link activation reached a URL outside the allowed Cengage/WebAssign boundary.'
      );
    }

    if (
      !popup &&
      href &&
      !isAllowedUrlForPolicy(targetPage.url(), 'cengage_page') &&
      isAllowedUrlForPolicy(href, 'cengage_page')
    ) {
      const safeHref = validateCengagePageTargetUrl(href);
      await targetPage.goto(safeHref, { waitUntil: 'load', timeout: 45000 });
      validateCengageFinalUrl(
        targetPage.url(),
        'WebAssign link fallback reached a URL outside the allowed boundary.'
      );
    }

    return targetPage;
  }

  private async findCourseLaunchLink(
    page: Page,
    course: CengageDashboardCourse
  ): Promise<Locator | null> {
    const selectors: string[] = [];
    if (course.courseKey) {
      selectors.push(
        `a[href*="${this.selectorLiteral(course.courseKey)}"][href]`
      );
    }

    selectors.push(
      `a[aria-label*="${this.selectorLiteral(course.title)}"][href]`,
      `a:has-text("${this.selectorLiteral(course.title)}")`
    );

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (count === 0) continue;

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      return locator;
    }

    return null;
  }

  private async tryRepairViaCourseMenu(
    page: Page,
    course: CengageDashboardCourse,
    options: GetWebAssignAssignmentsOptions
  ): Promise<WebAssignAssignmentsResult | null> {
    await this.revealWebAssignCourseMenu(page);
    const link = await this.findCourseLaunchLink(page, course);
    if (!link) return null;

    const targetPage = await this.activateLink(page, link);
    await this.waitForAssignmentSourceUrl(targetPage, {
      entryUrl: targetPage.url(),
      linkType: 'webassign_course',
      authMessage:
        'Cengage authentication is required before assignment extraction.',
      dashboardMessage:
        'Reached Cengage dashboard. A specific course selection is required before assignment extraction.',
    });
    return this.extractAssignmentsFromPage(targetPage, {
      entryUrl: targetPage.url(),
      linkType: 'webassign_course',
      options,
    });
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
        validateCengageFinalUrl(
          page.url(),
          'Canonical Cengage/WebAssign bootstrap reached a URL outside the allowed boundary.'
        );
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
          validateCengageFinalUrl(
            page.url(),
            'Provided Cengage/WebAssign URL reached a URL outside the allowed boundary.'
          );
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

  async getAssignmentsWithContext(
    ssoUrl: string,
    options: GetWebAssignAssignmentsOptions = {}
  ): Promise<WebAssignAssignmentsResult> {
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
        validateCengageFinalUrl(
          page.url(),
          'Provided Cengage/WebAssign URL reached a URL outside the allowed boundary.'
        );
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

      await this.waitForAssignmentSourceUrl(page, {
        entryUrl,
        linkType: entry.linkType,
        authMessage:
          'Cengage authentication is required before assignment extraction.',
        dashboardMessage:
          'Reached Cengage dashboard. A specific course selection is required before assignment extraction.',
      });
      return this.extractAssignmentsFromPage(page, {
        entryUrl,
        linkType: entry.linkType,
        options,
      });
    } finally {
      await context.close();
    }
  }

  async getAssignments(
    ssoUrl: string,
    options: GetWebAssignAssignmentsOptions = {}
  ): Promise<WebAssignAssignment[]> {
    const result = await this.getAssignmentsWithContext(ssoUrl, options);
    return result.assignments;
  }

  async getAssignmentsForDashboardCourse(
    course: CengageDashboardCourse,
    options: Omit<GetWebAssignAssignmentsOptions, 'expectedCourse'> = {}
  ): Promise<WebAssignAssignmentsResult> {
    const entryUrl = CENGAGE_CANONICAL_HOME_URLS[0];
    const mergedOptions: GetWebAssignAssignmentsOptions = {
      ...options,
      expectedCourse: course,
    };

    try {
      return await withAuthenticatedPage({
        entryUrl,
        linkType: 'cengage_dashboard',
        getBrowser: () => this.getBrowser(),
        callback: async (page) => {
          await page.goto(entryUrl, { waitUntil: 'load', timeout: 45000 });
          validateCengageFinalUrl(
            page.url(),
            'Cengage dashboard reached a URL outside the allowed boundary.'
          );
          await waitForCengagePageState(page, {
            timeoutMs: 9000,
            pollIntervalMs: 300,
            stableReadings: 1,
          });

          const link = await this.findCourseLaunchLink(page, course);
          if (!link) {
            throw new CengageNavigationError(
              'Could not find the selected course launch link on the Cengage dashboard.',
              {
                entryUrl,
                linkType: 'cengage_dashboard',
                expectedCourse: course,
              }
            );
          }

          const targetPage = await this.activateLink(page, link);
          await this.waitForAssignmentSourceUrl(targetPage, {
            entryUrl: targetPage.url(),
            linkType: 'webassign_course',
            authMessage:
              'Cengage authentication is required before assignment extraction.',
            dashboardMessage:
              'Reached Cengage dashboard. A specific course selection is required before assignment extraction.',
          });

          try {
            return await this.extractAssignmentsFromPage(targetPage, {
              entryUrl: targetPage.url(),
              linkType: 'webassign_course',
              options: mergedOptions,
            });
          } catch (error) {
            if (error instanceof CengageCourseActivationError) {
              const repaired = await this.tryRepairViaCourseMenu(
                targetPage,
                course,
                mergedOptions
              );
              if (repaired) return repaired;
            }
            throw error;
          }
        },
      });
    } catch (error) {
      if (error instanceof CengageCourseActivationError) {
        throw error;
      }

      return this.getAssignmentsWithContext(course.launchUrl, mergedOptions);
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
        validateCengageFinalUrl(
          page.url(),
          'Provided Cengage/WebAssign URL reached a URL outside the allowed boundary.'
        );
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

      await this.revealWebAssignCourseMenu(page);
      const activeCourseContext = await collectWebAssignCourseContext(page);
      this.assertExpectedCourseContext(activeCourseContext, options);

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
        activeCourseContext.currentCourseTitle || (await page.title())
      );

      const assignments = parseWebAssignAssignments(rowCandidates, {
        courseId:
          activeCourseContext.currentSelected || inferredCourse?.courseId,
        courseKey: inferredCourse?.courseKey,
        courseTitle:
          activeCourseContext.currentCourseTitle || inferredCourse?.title,
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
        const safeTargetAssignmentUrl =
          validateCengagePageTargetUrl(targetAssignmentUrl);
        await page.goto(safeTargetAssignmentUrl, {
          waitUntil: 'load',
          timeout: 45000,
        });
        validateCengageFinalUrl(
          page.url(),
          'Selected WebAssign assignment page reached a URL outside the allowed boundary.'
        );
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
    activeCengageScrapers.delete(this);
    const browser = this.browser;
    this.browser = null;

    if (browser) {
      await browser.close();
    }
  }
}
