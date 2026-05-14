import type { Page } from 'playwright';
import type { CengageDashboardCourse } from '../cengage-courses';

export interface WebAssignCourseContext {
  pageUrl: string;
  pageTitle: string;
  currentSelected?: string;
  currentCourseTitle?: string;
  dataCourses?: Record<
    string,
    { course?: string; section?: string | null; term?: string }
  >;
  courseMenuLinks: Array<{
    title: string;
    href: string;
    courseKey?: string;
  }>;
}

export type WebAssignCourseContextVerification =
  | { ok: true }
  | {
      ok: false;
      reason: 'course_context_mismatch';
      diagnostics: Record<string, unknown>;
    };

function normalizeText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeComparableTitle(value: string | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+-\s+my assignments.*$/i, '')
    .trim();
}

export function compactCourseCode(value: string | undefined): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function courseCodeCandidates(value: string | undefined): string[] {
  const raw = (value || '').toUpperCase();
  const matches = raw.match(/\b[A-Z]{2,5}\s?\d{3,4}[A-Z]?\b/g) || [];
  return Array.from(new Set(matches.map(compactCourseCode).filter(Boolean)));
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

function courseKeyFromUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return normalizeText(parsed.searchParams.get('courseKey') || undefined);
  } catch {
    return undefined;
  }
}

function expectedTitlesFromCourse(
  expectedCourse: CengageDashboardCourse,
  actual: WebAssignCourseContext,
  expectedCourseTitle?: string
): string[] {
  const titles = [
    expectedCourseTitle,
    expectedCourse.title,
    ...actual.courseMenuLinks
      .filter(
        (link) =>
          expectedCourse.courseKey &&
          link.courseKey &&
          normalizeComparableTitle(link.courseKey) ===
            normalizeComparableTitle(expectedCourse.courseKey)
      )
      .map((link) => link.title),
  ];

  return Array.from(
    new Set(
      titles.map(normalizeText).filter((title) => !isGenericCourseTitle(title))
    )
  );
}

export async function collectWebAssignCourseContext(
  page: Page
): Promise<WebAssignCourseContext> {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined): string =>
      (value || '').replace(/\s+/g, ' ').trim();

    const courseKeyFromHref = (value: string): string | undefined => {
      try {
        const parsed = new URL(value, window.location.href);
        return normalize(parsed.searchParams.get('courseKey'));
      } catch {
        return undefined;
      }
    };

    const currentElement = document.querySelector<HTMLElement>(
      '[data-current-selected]'
    );
    const currentSelected = normalize(
      currentElement?.getAttribute('data-current-selected')
    );
    const dataCoursesRaw = currentElement?.getAttribute('data-courses') || '';
    let dataCourses:
      | Record<
          string,
          { course?: string; section?: string | null; term?: string }
        >
      | undefined;
    try {
      const parsed = JSON.parse(dataCoursesRaw);
      if (parsed && typeof parsed === 'object') {
        dataCourses = parsed;
      }
    } catch {
      dataCourses = undefined;
    }

    const currentText =
      normalize((currentElement as HTMLElement | null)?.innerText) ||
      normalize(currentElement?.textContent);
    const currentTextMatch = currentText.match(
      /CURRENT COURSE\s+(.+?)(?:\s+Instructor\b|\s+Home\b|\s+My Assignments\b|\s+Grades\b|\s+Communication\b|$)/i
    );
    const currentCourseTitleFromText = normalize(currentTextMatch?.[1]);
    const currentCourseTitleFromData =
      currentSelected && dataCourses?.[currentSelected]?.course
        ? normalize(
            [
              dataCourses[currentSelected].course,
              dataCourses[currentSelected].section,
              dataCourses[currentSelected].term,
            ]
              .filter(Boolean)
              .join(', ')
          )
        : '';

    const courseMenuLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="courseKey="]')
    )
      .map((anchor) => {
        const href = anchor.href || anchor.getAttribute('href') || '';
        const title =
          normalize(anchor.textContent) ||
          normalize(anchor.getAttribute('aria-label')) ||
          normalize(anchor.getAttribute('title'));
        return {
          title,
          href,
          courseKey: courseKeyFromHref(href),
        };
      })
      .filter((link) => link.title && link.href);

    return {
      pageUrl: window.location.href,
      pageTitle: document.title || '',
      currentSelected: currentSelected || undefined,
      currentCourseTitle:
        currentCourseTitleFromData || currentCourseTitleFromText || undefined,
      dataCourses,
      courseMenuLinks,
    };
  });
}

export function verifyWebAssignCourseContext(params: {
  expectedCourse: CengageDashboardCourse;
  expectedCourseTitle?: string;
  expectedCourseCode?: string;
  actual: WebAssignCourseContext;
}): WebAssignCourseContextVerification {
  const expectedTitles = expectedTitlesFromCourse(
    params.expectedCourse,
    params.actual,
    params.expectedCourseTitle
  );
  const actualTitle =
    params.actual.currentCourseTitle || params.actual.pageTitle || undefined;
  const actualCodes = courseCodeCandidates(actualTitle);
  const expectedCodes = Array.from(
    new Set(
      [
        ...expectedTitles.flatMap(courseCodeCandidates),
        compactCourseCode(params.expectedCourseCode),
      ].filter(Boolean)
    )
  );

  const diagnostics = {
    expectedCourse: params.expectedCourse,
    expectedCourseTitle: params.expectedCourseTitle,
    expectedCourseCode: params.expectedCourseCode,
    expectedTitles,
    expectedCodes,
    actualCourseTitle: params.actual.currentCourseTitle,
    actualPageTitle: params.actual.pageTitle,
    actualCurrentSelected: params.actual.currentSelected,
    actualCodes,
    actualCourseMenuLinks: params.actual.courseMenuLinks,
  };

  let hasConcreteCourseCodeMatch = false;
  if (expectedCodes.length > 0 && actualCodes.length > 0) {
    const overlaps = expectedCodes.some((code) => actualCodes.includes(code));
    if (!overlaps) {
      return {
        ok: false,
        reason: 'course_context_mismatch',
        diagnostics,
      };
    }
    hasConcreteCourseCodeMatch = true;
  }

  const comparableActualTitle = normalizeComparableTitle(actualTitle);
  if (
    !hasConcreteCourseCodeMatch &&
    expectedTitles.length > 0 &&
    comparableActualTitle
  ) {
    const titleMatches = expectedTitles.some((title) => {
      const comparableExpected = normalizeComparableTitle(title);
      return (
        comparableActualTitle.includes(comparableExpected) ||
        comparableExpected.includes(comparableActualTitle)
      );
    });
    if (!titleMatches) {
      return {
        ok: false,
        reason: 'course_context_mismatch',
        diagnostics,
      };
    }
  }

  const expectedCourseKey = normalizeText(params.expectedCourse.courseKey);
  const matchingMenuTitle =
    expectedCourseKey &&
    params.actual.courseMenuLinks.find(
      (link) =>
        link.courseKey &&
        normalizeComparableTitle(link.courseKey) ===
          normalizeComparableTitle(expectedCourseKey)
    )?.title;
  const activeTitle = params.actual.currentCourseTitle;
  if (
    matchingMenuTitle &&
    activeTitle &&
    !isGenericCourseTitle(matchingMenuTitle) &&
    !isGenericCourseTitle(activeTitle)
  ) {
    const expectedCodesFromMenu = courseCodeCandidates(matchingMenuTitle);
    const activeCodes = courseCodeCandidates(activeTitle);
    if (
      expectedCodesFromMenu.length > 0 &&
      activeCodes.length > 0 &&
      !expectedCodesFromMenu.some((code) => activeCodes.includes(code))
    ) {
      return {
        ok: false,
        reason: 'course_context_mismatch',
        diagnostics,
      };
    }
  }

  return { ok: true };
}

export function inferCourseKeyFromContextUrl(
  context: WebAssignCourseContext
): string | undefined {
  return courseKeyFromUrl(context.pageUrl);
}
