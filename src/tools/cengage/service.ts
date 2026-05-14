import {
  CengageScraper,
  type WebAssignAssignment,
} from '../../scraper/cengage';
import type { CengageDashboardCourse } from '../../scraper/cengage-courses';
import { CengageCourseActivationError } from '../../scraper/cengage-errors';
import {
  compactCourseCode,
  courseCodeCandidates,
  normalizeComparableTitle,
} from '../../scraper/cengage/course-context';
import { cache, getCacheKey, TTL } from '../../cache/store';

export const CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY = '__dashboard_session__';

export const CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY = getCacheKey(
  'cengage',
  'dashboard_inventory',
  'session'
);

export const CENGAGE_LIST_COURSES_TTL_MINUTES = TTL.CONTENT;

export interface CengageDashboardInventoryOptions {
  entryUrl?: string;
  scraper?: CengageScraper;
}

export interface CengageAssignmentsForCourseOptions {
  scraper?: CengageScraper;
  expectedCourseTitle?: string;
  expectedCourseCode?: string;
}

function isGenericCourseTitle(value: string | undefined): boolean {
  const normalized = normalizeComparableTitle(value);
  return (
    !normalized ||
    normalized === 'webassign' ||
    normalized === 'cengage' ||
    normalized.startsWith('webassign wa-production')
  );
}

export function validateCengageAssignmentCourseContext(
  course: CengageDashboardCourse,
  assignments: WebAssignAssignment[],
  options: Pick<
    CengageAssignmentsForCourseOptions,
    'expectedCourseTitle' | 'expectedCourseCode'
  > = {}
): void {
  if (assignments.length === 0) {
    return;
  }

  const actualCourseTitle = assignments.find(
    (item) => item.courseTitle
  )?.courseTitle;
  const actualCourseId = assignments.find((item) => item.courseId)?.courseId;

  if (
    course.courseId &&
    actualCourseId &&
    normalizeComparableTitle(course.courseId) !==
      normalizeComparableTitle(actualCourseId)
  ) {
    throw new CengageCourseActivationError(
      'Cengage/WebAssign landed in a different course context than the selected course. Refusing to return assignments from the wrong course.',
      {
        expectedCourse: course,
        actualCourseId,
        actualCourseTitle,
      }
    );
  }

  const expectedCodes = Array.from(
    new Set(
      [
        ...courseCodeCandidates(course.title),
        ...courseCodeCandidates(options.expectedCourseTitle),
        compactCourseCode(options.expectedCourseCode),
      ].filter(Boolean)
    )
  );
  const actualCodes = courseCodeCandidates(actualCourseTitle);
  let hasConcreteCourseCodeMatch = false;
  if (expectedCodes.length > 0 && actualCodes.length > 0) {
    const overlaps = expectedCodes.some((code) => actualCodes.includes(code));
    if (!overlaps) {
      throw new CengageCourseActivationError(
        'Cengage/WebAssign landed in a different course context than the selected course. Refusing to return assignments from the wrong course.',
        {
          expectedCourse: course,
          actualCourseTitle,
          expectedCourseCodes: expectedCodes,
          actualCourseCodes: actualCodes,
        }
      );
    }
    hasConcreteCourseCodeMatch = true;
  }

  if (
    isGenericCourseTitle(course.title) &&
    !options.expectedCourseTitle &&
    !options.expectedCourseCode &&
    !actualCourseId &&
    actualCodes.length > 0
  ) {
    throw new CengageCourseActivationError(
      'Cengage/WebAssign landed in a different course context than the selected course. Refusing to return assignments from the wrong course.',
      {
        expectedCourse: course,
        actualCourseTitle,
        actualCourseCodes: actualCodes,
        reason: 'generic_selected_course_context_unverified',
      }
    );
  }

  const expectedTitleForComparison = [
    options.expectedCourseTitle,
    course.title,
  ].find((title) => !isGenericCourseTitle(title));

  if (
    !hasConcreteCourseCodeMatch &&
    !isGenericCourseTitle(expectedTitleForComparison) &&
    !isGenericCourseTitle(actualCourseTitle)
  ) {
    const expectedTitle = normalizeComparableTitle(expectedTitleForComparison);
    const actualTitle = normalizeComparableTitle(actualCourseTitle);
    if (
      expectedTitle &&
      actualTitle &&
      !actualTitle.includes(expectedTitle) &&
      !expectedTitle.includes(actualTitle)
    ) {
      throw new CengageCourseActivationError(
        'Cengage/WebAssign landed in a different course context than the selected course. Refusing to return assignments from the wrong course.',
        {
          expectedCourse: course,
          actualCourseTitle,
        }
      );
    }
  }
}

export function isCengageCourseContextMismatch(error: unknown): boolean {
  return (
    error instanceof CengageCourseActivationError &&
    !!(
      error.details?.actualCourseTitle ||
      error.details?.actualCourseId ||
      error.details?.actualCurrentSelected
    )
  );
}

export async function getCengageDashboardInventory(
  options: CengageDashboardInventoryOptions = {}
): Promise<CengageDashboardCourse[]> {
  const ownedScraper = options.scraper ? null : new CengageScraper();
  const scraper = options.scraper || ownedScraper;

  if (!scraper) {
    return [];
  }

  try {
    if (options.entryUrl) {
      return await scraper.listDashboardCoursesFromEntryLink(options.entryUrl);
    }

    const cached = cache.getWithMeta<CengageDashboardCourse[]>(
      CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY
    );
    if (cached) {
      return cached.data;
    }

    const courses = await scraper.listDashboardCoursesFromSavedSession();
    cache.set(
      CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY,
      courses,
      CENGAGE_LIST_COURSES_TTL_MINUTES
    );
    return courses;
  } finally {
    if (ownedScraper) {
      await ownedScraper.close();
    }
  }
}

export async function getCengageAssignmentsForCourse(
  course: CengageDashboardCourse,
  options: CengageAssignmentsForCourseOptions = {}
): Promise<{
  selectedCourse: CengageDashboardCourse;
  assignments: WebAssignAssignment[];
}> {
  const ownedScraper = options.scraper ? null : new CengageScraper();
  const scraper = options.scraper || ownedScraper;

  if (!scraper) {
    return { selectedCourse: course, assignments: [] };
  }

  try {
    const result = await scraper.getAssignmentsForDashboardCourse(course, {
      expectedCourseTitle: options.expectedCourseTitle,
      expectedCourseCode: options.expectedCourseCode,
    });
    const { assignments } = result;
    validateCengageAssignmentCourseContext(course, assignments, options);
    return { selectedCourse: course, assignments };
  } finally {
    if (ownedScraper) {
      await ownedScraper.close();
    }
  }
}
