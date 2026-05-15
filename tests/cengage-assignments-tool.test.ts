import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { CACHE_SCHEMA_VERSION, cache, getCacheKey } from '../src/cache/store';
import { CengageScraper } from '../src/scraper/cengage';
import {
  CengageAuthRequiredError,
  CengageCourseActivationError,
  CengageError,
  CengageNavigationError,
} from '../src/scraper/cengage-errors';
import { SecureSessionStorageError } from '../src/security/secure-session-store';
import { getCengageAssignments } from '../src/tools/cengage';

const SAMPLE_COURSE = {
  courseId: 'math-1010',
  courseKey: 'WA-production-1001',
  title: 'MATH 1010 - Calculus I',
  launchUrl:
    'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
  platform: 'webassign' as const,
  confidence: 0.95,
};

function uniqueEntryUrl(tag: string): string {
  return `https://www.cengage.com/dashboard/home?test=${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function uniqueWebAssignUrl(tag: string): string {
  return `https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001&test=${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function withContext(assignments: any[]) {
  return {
    assignments,
    context: {
      pageUrl: 'https://www.webassign.net/v4cgi/student.pl?course=math',
      pageTitle: 'MATH 1010 - Calculus I - My Assignments | WebAssign',
      currentSelected: 'math-1010',
      currentCourseTitle: 'MATH 1010 - Calculus I',
      courseMenuLinks: [],
    },
  };
}

function isolateDashboardInventoryCache() {
  const inventoryKey = getCacheKey('cengage', 'dashboard_inventory', 'session');
  const realGetWithMeta = cache.getWithMeta.bind(cache);
  const realSet = cache.set.bind(cache);

  let inventoryEntry: {
    fetched_at: string;
    expires_at: string;
    data: unknown;
    version: number;
  } | null = null;

  vi.spyOn(cache, 'getWithMeta').mockImplementation((key: string) => {
    if (key === inventoryKey) {
      return inventoryEntry as any;
    }
    return realGetWithMeta(key as any) as any;
  });

  vi.spyOn(cache, 'set').mockImplementation(
    (key: string, value, ttlMinutes) => {
      if (key === inventoryKey) {
        const now = new Date();
        inventoryEntry = {
          fetched_at: now.toISOString(),
          expires_at: new Date(
            now.getTime() + ttlMinutes * 60000
          ).toISOString(),
          data: value,
          version: CACHE_SCHEMA_VERSION,
        };
        return;
      }
      realSet(key as any, value as any, ttlMinutes as any);
    }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('get cengage assignments tool on new core', () => {
  it('supports dashboard-first mode when entry URL is omitted', async () => {
    isolateDashboardInventoryCache();

    const uniqueCourse = {
      ...SAMPLE_COURSE,
      title: `Dashboard Bootstrap ${Date.now()}`,
    };

    const sessionListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromSavedSession')
      .mockResolvedValue([uniqueCourse]);
    const entryListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([uniqueCourse]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      courseQuery: uniqueCourse.title,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.selectedCourse.title).toBe(uniqueCourse.title);
    expect(payload.assignments).toHaveLength(0);
    expect(sessionListSpy).toHaveBeenCalledTimes(1);
    expect(entryListSpy).not.toHaveBeenCalled();
    expect(assignmentsSpy).toHaveBeenCalledWith(
      uniqueCourse,
      expect.objectContaining({ expectedCourseTitle: uniqueCourse.title })
    );
  });

  it('supports legacy string input and returns selected course assignments', async () => {
    const entryUrl = uniqueWebAssignUrl('legacy');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([SAMPLE_COURSE]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsWithContext')
      .mockResolvedValue(
        withContext([
          {
            id: 'asg-1001',
            name: 'Homework 1',
            dueDate: '2026-04-15 23:59',
            dueDateIso: '2026-04-15T23:59:00',
            status: 'Pending',
            score: undefined,
            courseId: 'math-1010',
            courseTitle: 'MATH 1010 - Calculus I',
            url: '/assignment/1001',
            rawText: 'Homework 1 Due Date Apr 15, 2026 11:59 PM',
          },
        ])
      );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments(entryUrl);
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload._cache).toBeDefined();
    expect(payload._cache.hit).toBe(false);
    expect(payload.selectedCourse.courseKey).toBe('WA-production-1001');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.assignments[0].status).toBe('pending');

    expect(listSpy).not.toHaveBeenCalled();
    expect(assignmentsSpy).toHaveBeenCalledWith(
      entryUrl,
      expect.objectContaining({
        expectedCourse: expect.objectContaining({
          courseKey: 'WA-production-1001',
        }),
      })
    );
  });

  it('refuses assignments when WebAssign lands in a different selected course context', async () => {
    const entryUrl = uniqueEntryUrl('course-context-mismatch');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(
      new CengageCourseActivationError(
        'WebAssign opened a different active course than the selected Cengage course.',
        {
          actualCourseTitle: 'PHYS 1800 Fall 2025 Final, Fall 2025',
          actualCurrentSelected: '1199639,1577413',
        }
      )
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseQuery: 'MATH 1010',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('needs_course_activation');
    expect(payload.code).toBe('COURSE_CONTEXT_MISMATCH');
    expect(payload.assignments).toHaveLength(0);
    expect(payload.message).toContain('different active course');
    expect(payload.retry.afterAuth).toBe(false);
    expect(payload.retry.reason).toBe('course_activation_required');
  });

  it('refuses generic entry-url course context when returned rows reveal another course', async () => {
    const entryUrl =
      'https://www.webassign.net/v4cgi/login.pl?pid=571417&eISBN=9780357128992&courseKey=WA-production-1607530&titleIsbn=9781337613927' +
      `&test=${Date.now()}-${Math.random().toString(16).slice(2)}`;
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsWithContext'
    ).mockRejectedValue(
      new CengageCourseActivationError(
        'WebAssign opened a different active course than the selected Cengage course.',
        {
          actualCourseTitle: 'PHYS 1800 Fall 2025 Final, Fall 2025',
          actualCurrentSelected: '1199639,1577413',
        }
      )
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseKey: 'WA-production-1607530',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('needs_course_activation');
    expect(payload.code).toBe('COURSE_CONTEXT_MISMATCH');
    expect(payload.selectedCourse.courseKey).toBe('WA-production-1607530');
    expect(payload.assignments).toHaveLength(0);
    expect(payload.message).toContain('different active course');
    expect(payload.retry.input.courseKey).toBe('WA-production-1607530');
    expect(payload.retry.afterAuth).toBe(false);
  });

  it('returns needs_course_selection when multiple courses exist without selector', async () => {
    const entryUrl = uniqueEntryUrl('needs-selection');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([
      SAMPLE_COURSE,
      {
        ...SAMPLE_COURSE,
        courseId: 'math-1020',
        courseKey: 'WA-production-1002',
        title: 'MATH 1010 - Calculus II',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1002',
        confidence: 0.92,
      },
    ]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('needs_course_selection');
    expect(payload.assignments).toHaveLength(0);
    expect(assignmentsSpy).not.toHaveBeenCalled();
  });

  it('uses courseQuery to resolve and fetch assignments from selected course', async () => {
    const entryUrl = uniqueEntryUrl('query');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([
      SAMPLE_COURSE,
      {
        ...SAMPLE_COURSE,
        courseId: 'math-1020',
        courseKey: 'WA-production-1002',
        title: 'MATH 1010 - Calculus II',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1002',
        confidence: 0.93,
      },
    ]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseQuery: 'MATH 1010 - Calculus II',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.selectedCourse.title).toBe('MATH 1010 - Calculus II');
    expect(assignmentsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1002',
      }),
      expect.objectContaining({
        expectedCourseTitle: 'MATH 1010 - Calculus II',
      })
    );
  });

  it('does not try to scrape assignments from OWLv2 courses', async () => {
    const entryUrl = uniqueEntryUrl('owlv2-assignments');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([
      {
        courseId: 'chem-1100',
        courseKey: 'E-KY652BRRTNJRY',
        title: 'Winter 2026: CHEM 1100 Sec N',
        launchUrl:
          'https://prod01-cnow-owl.cengagenow.com/ilrn/authentication.do?courseKey=E-KY652BRRTNJRY',
        platform: 'owlv2' as const,
        assignmentsSupported: false,
        confidence: 0.9,
      },
    ]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseQuery: 'CHEM 1100',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.selectedCourse).toEqual(
      expect.objectContaining({
        title: 'Winter 2026: CHEM 1100 Sec N',
        platform: 'owlv2',
        assignmentsSupported: false,
      })
    );
    expect(payload.message).toContain('assignment extraction is not supported');
    expect(assignmentsSpy).not.toHaveBeenCalled();
  });

  it('returns no_data when selectors do not match any course', async () => {
    const entryUrl = uniqueEntryUrl('not-found');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseId: 'missing-course',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.assignments).toHaveLength(0);
    expect(assignmentsSpy).not.toHaveBeenCalled();
  });

  it('maps auth-required errors to auth_required status', async () => {
    const entryUrl = uniqueEntryUrl('auth');
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => {});
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockRejectedValue(new CengageAuthRequiredError('Auth required'));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('auth_required');
    expect(payload.message).toContain('Opened auth at');
    expect(payload.retry.afterAuth).toBe(true);
    expect(payload.retry.authUrl).toContain('/auth-cengage');
    expect(payload.retry.input.entryUrl).toBe(entryUrl);
    expect(openAuthSpy).toHaveBeenCalledWith('cengage');
  });

  it('serves repeat identical assignment requests from cache', async () => {
    const entryUrl = uniqueEntryUrl('cache-hit');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([SAMPLE_COURSE]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const first = await getCengageAssignments({ entryUrl });
    const firstPayload = JSON.parse(first.content[0].text);
    expect(firstPayload._cache.hit).toBe(false);

    const second = await getCengageAssignments({ entryUrl });
    const secondPayload = JSON.parse(second.content[0].text);
    expect(secondPayload._cache.hit).toBe(true);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(assignmentsSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses dashboard inventory cache across no-entry assignment queries', async () => {
    isolateDashboardInventoryCache();

    const courseA = {
      ...SAMPLE_COURSE,
      title: `Inventory Assignments A ${Date.now()}`,
      launchUrl:
        'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-6101',
    };
    const courseB = {
      ...SAMPLE_COURSE,
      courseId: 'math-1020',
      courseKey: 'WA-production-6102',
      title: `Inventory Assignments B ${Date.now()}`,
      launchUrl:
        'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-6102',
    };

    const sessionListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromSavedSession')
      .mockResolvedValue([courseA, courseB]);
    const entryListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([courseA, courseB]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const first = await getCengageAssignments({ courseQuery: courseA.title });
    const firstPayload = JSON.parse(first.content[0].text);
    expect(firstPayload.status).toBe('no_data');
    expect(firstPayload.selectedCourse.title).toBe(courseA.title);

    const second = await getCengageAssignments({ courseQuery: courseB.title });
    const secondPayload = JSON.parse(second.content[0].text);
    expect(secondPayload.status).toBe('no_data');
    expect(secondPayload.selectedCourse.title).toBe(courseB.title);

    expect(sessionListSpy).toHaveBeenCalledTimes(1);
    expect(entryListSpy).not.toHaveBeenCalled();
    expect(assignmentsSpy).toHaveBeenCalledTimes(2);
  });

  it('supports bounded all-courses aggregation mode from dashboard inventory', async () => {
    isolateDashboardInventoryCache();
    const aggregateTag = `aggregate-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const courseA = {
      ...SAMPLE_COURSE,
      title: `Aggregate A ${aggregateTag}`,
      launchUrl:
        'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-7201',
    };
    const courseB = {
      ...SAMPLE_COURSE,
      courseId: 'math-1020',
      courseKey: 'WA-production-7202',
      title: `Aggregate B ${aggregateTag}`,
      launchUrl:
        'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-7202',
    };

    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([courseA, courseB]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockImplementation(async (course: any) => {
        if (course.launchUrl === courseA.launchUrl) {
          return withContext([
            {
              id: 'asg-a-1',
              name: 'A1',
              dueDate: '2026-04-15 23:59',
              status: 'Pending',
              courseId: courseA.courseId,
              courseTitle: courseA.title,
              rawText: 'A1 Due Date',
            } as any,
          ]);
        }

        return withContext([
          {
            id: 'asg-b-1',
            name: 'B1',
            dueDate: '2026-04-18 23:59',
            status: 'Submitted',
            courseId: courseB.courseId,
            courseTitle: courseB.title,
            rawText: 'B1 Due Date',
          } as any,
        ]);
      });

    const result = await getCengageAssignments({
      allCourses: true,
      courseQuery: aggregateTag,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.aggregation.mode).toBe('all_courses');
    expect(payload.aggregation.coursesProcessed).toBe(2);
    expect(payload.allCourses).toHaveLength(2);
    expect(payload.assignments).toHaveLength(2);
    expect(assignmentsSpy).toHaveBeenCalledTimes(2);
  });

  it('applies maxCourses and maxAssignmentsPerCourse bounds in all-courses mode', async () => {
    isolateDashboardInventoryCache();
    const boundedTag = `bounded-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const courses = [
      {
        ...SAMPLE_COURSE,
        title: `Bounded A ${boundedTag}`,
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-7301',
      },
      {
        ...SAMPLE_COURSE,
        courseId: 'math-1020',
        courseKey: 'WA-production-7302',
        title: `Bounded B ${boundedTag}`,
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-7302',
      },
      {
        ...SAMPLE_COURSE,
        courseId: 'math-1030',
        courseKey: 'WA-production-7303',
        title: `Bounded C ${boundedTag}`,
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-7303',
      },
    ];

    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue(courses);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(
        withContext([
          {
            id: 'asg-1',
            name: 'First',
            dueDate: '2026-04-20 23:59',
            status: 'Pending',
            rawText: 'First Due Date',
          } as any,
          {
            id: 'asg-2',
            name: 'Second',
            dueDate: '2026-04-21 23:59',
            status: 'Pending',
            rawText: 'Second Due Date',
          } as any,
        ])
      );

    const result = await getCengageAssignments({
      allCourses: true,
      courseQuery: boundedTag,
      maxCourses: 2,
      maxAssignmentsPerCourse: 1,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.aggregation.coursesConsidered).toBe(3);
    expect(payload.aggregation.coursesProcessed).toBe(2);
    expect(payload.aggregation.truncatedCourses).toBe(true);
    expect(payload.aggregation.truncatedAssignments).toBe(true);
    expect(payload.assignments).toHaveLength(2);
    expect(payload.allCourses[0].returnedAssignments).toBe(1);
    expect(assignmentsSpy).toHaveBeenCalledTimes(2);
  });

  it('maps secure storage failures to a non-retrying session storage error', async () => {
    const entryUrl = uniqueEntryUrl('storage-unavailable');
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => {});
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockRejectedValue(
      new SecureSessionStorageError(
        'decrypt_failed',
        'Unable to decrypt Cengage session'
      )
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({ entryUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('error');
    expect(payload.code).toBe('SESSION_STORAGE_UNAVAILABLE');
    expect(payload.retry).toEqual({ afterAuth: false });
    expect(payload.message).toContain('Secure session storage is unavailable');
    expect(openAuthSpy).not.toHaveBeenCalled();
  });

  it('keeps Cengage parser codes visible in assignment-list failures', async () => {
    const entryUrl = uniqueEntryUrl('parse-error');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(
      new CengageError('parse_failed', 'Assignment rows changed')
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({ entryUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('error');
    expect(payload.assignments).toEqual([]);
    expect(payload.message).toBe('Assignment rows changed [parse_failed]');
  });

  it('returns a stable generic error when assignment scraping throws an Error', async () => {
    const entryUrl = uniqueEntryUrl('generic-error');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(new Error('browser context closed'));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({ entryUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('error');
    expect(payload.assignments).toEqual([]);
    expect(payload.message).toBe(
      'Failed to fetch Cengage assignments: browser context closed'
    );
  });

  it('returns a stable unknown-error response for non-Error assignment failures', async () => {
    const entryUrl = uniqueEntryUrl('unknown-error');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue('opaque failure');
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({ entryUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('error');
    expect(payload.assignments).toEqual([]);
    expect(payload.message).toBe(
      'Failed to fetch Cengage assignments due to an unknown error.'
    );
  });

  it('returns no_data for a verified direct WebAssign link with an empty assignment table', async () => {
    const entryUrl = uniqueWebAssignUrl('direct-empty');
    const directSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsWithContext')
      .mockResolvedValue(withContext([]));
    const dashboardSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([SAMPLE_COURSE]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseKey: SAMPLE_COURSE.courseKey,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.selectedCourse.courseKey).toBe(SAMPLE_COURSE.courseKey);
    expect(payload.message).toBe(
      'No assignments were found in the verified WebAssign course context.'
    );
    expect(directSpy).toHaveBeenCalledWith(
      entryUrl,
      expect.objectContaining({
        expectedCourse: expect.objectContaining({
          courseKey: SAMPLE_COURSE.courseKey,
        }),
      })
    );
    expect(dashboardSpy).not.toHaveBeenCalled();
  });

  it('falls back to dashboard course selection when a direct WebAssign link bounces to Cengage dashboard', async () => {
    const entryUrl = uniqueWebAssignUrl('direct-dashboard-fallback');
    const directSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsWithContext')
      .mockRejectedValue(
        new CengageNavigationError(
          'Cengage dashboard was shown instead of WebAssign assignments'
        )
      );
    const dashboardSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([SAMPLE_COURSE]);
    const courseSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(
        withContext([
          {
            id: 'fallback-1',
            name: 'Fallback Homework',
            dueDate: '2026-04-20 23:59',
            status: 'Pending',
            rawText: 'Fallback Homework Due Date',
          } as any,
        ])
      );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseKey: SAMPLE_COURSE.courseKey,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.assignments[0].name).toBe('Fallback Homework');
    expect(directSpy).toHaveBeenCalledTimes(1);
    expect(dashboardSpy).toHaveBeenCalledTimes(1);
    expect(courseSpy).toHaveBeenCalledWith(
      SAMPLE_COURSE,
      expect.objectContaining({ expectedCourseTitle: undefined })
    );
  });

  it('returns activation diagnostics from a direct WebAssign link before trying dashboard fallback', async () => {
    const entryUrl = uniqueWebAssignUrl('direct-activation');
    const dashboardSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([SAMPLE_COURSE]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsWithContext'
    ).mockRejectedValue(
      new CengageCourseActivationError(
        'WebAssign opened a different active course than the selected Cengage course.',
        {
          actualCourseTitle: 'PHYS 1800 Fall 2025 Final',
          actualCurrentSelected: '1199639,1577413',
        }
      )
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseKey: SAMPLE_COURSE.courseKey,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('needs_course_activation');
    expect(payload.code).toBe('COURSE_CONTEXT_MISMATCH');
    expect(payload.selectedCourse.courseKey).toBe(SAMPLE_COURSE.courseKey);
    expect(payload.retry.input.courseKey).toBe(SAMPLE_COURSE.courseKey);
    expect(payload.diagnostics.actualCourseTitle).toContain('PHYS 1800');
    expect(dashboardSpy).not.toHaveBeenCalled();
  });

  it('reports per-course failures in all-courses aggregation without dropping successful courses', async () => {
    isolateDashboardInventoryCache();
    const tag = `aggregate-errors-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const courses = [
      { ...SAMPLE_COURSE, title: `Good ${tag}`, courseKey: 'WA-good' },
      {
        ...SAMPLE_COURSE,
        courseId: 'parse-course',
        courseKey: 'WA-parse',
        title: `Parse ${tag}`,
      },
      {
        ...SAMPLE_COURSE,
        courseId: 'browser-course',
        courseKey: 'WA-browser',
        title: `Browser ${tag}`,
      },
      {
        ...SAMPLE_COURSE,
        courseId: 'opaque-course',
        courseKey: 'WA-opaque',
        title: `Opaque ${tag}`,
      },
    ];
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue(courses);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockImplementation(async (course: any) => {
      if (course.courseKey === 'WA-good') {
        return withContext([
          {
            id: 'good-1',
            name: 'Good Homework',
            dueDate: '2026-04-20 23:59',
            status: 'Pending',
            rawText: 'Good Homework Due Date',
          } as any,
        ]);
      }
      if (course.courseKey === 'WA-parse') {
        throw new CengageError('parse_failed', 'Assignment table changed');
      }
      if (course.courseKey === 'WA-browser') {
        throw new Error('browser crashed');
      }
      throw 'opaque failure';
    });

    const result = await getCengageAssignments({
      allCourses: true,
      courseQuery: tag,
      maxCourses: 4,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.aggregation.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Assignment table changed [parse_failed]'),
        expect.stringContaining('browser crashed'),
        expect.stringContaining('Unknown error'),
      ])
    );
    expect(payload.allCourses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: `Good ${tag}`, status: 'ok' }),
        expect.objectContaining({
          title: `Parse ${tag}`,
          status: 'error',
          message: 'Assignment table changed [parse_failed]',
        }),
        expect.objectContaining({
          title: `Browser ${tag}`,
          status: 'error',
          message: 'browser crashed',
        }),
        expect.objectContaining({
          title: `Opaque ${tag}`,
          status: 'error',
          message: 'Unknown error',
        }),
      ])
    );
  });

  it('returns no_data when all-courses aggregation filters out every dashboard course', async () => {
    isolateDashboardInventoryCache();
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([SAMPLE_COURSE]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      allCourses: true,
      courseQuery: 'definitely missing course',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.assignments).toEqual([]);
    expect(payload.allCourses).toEqual([]);
    expect(payload.aggregation).toMatchObject({
      mode: 'all_courses',
      coursesConsidered: 0,
      coursesProcessed: 0,
      coursesReturned: 0,
    });
    expect(assignmentsSpy).not.toHaveBeenCalled();
  });

  it('summarizes empty WebAssign and unsupported OWLv2 courses in all-courses aggregation', async () => {
    isolateDashboardInventoryCache();
    const tag = `aggregate-empty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const webassignCourse = {
      ...SAMPLE_COURSE,
      title: `Empty WebAssign ${tag}`,
      courseKey: 'WA-empty-aggregate',
    };
    const owlCourse = {
      courseId: 'chem-owl-aggregate',
      courseKey: 'E-OWL-AGGREGATE',
      title: `Unsupported OWLv2 ${tag}`,
      launchUrl:
        'https://prod01-cnow-owl.cengagenow.com/ilrn/authentication.do?courseKey=E-OWL-AGGREGATE',
      platform: 'owlv2' as const,
      assignmentsSupported: false,
      confidence: 0.9,
    };
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([webassignCourse, owlCourse]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      allCourses: true,
      courseQuery: tag,
      maxCourses: 5,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.message).toBe(
      'No assignments were found across the selected courses.'
    );
    expect(payload.assignments).toEqual([]);
    expect(payload.allCourses).toEqual([
      expect.objectContaining({
        title: webassignCourse.title,
        status: 'no_data',
        assignmentCount: 0,
        message:
          'No assignments were returned for this course in the current session.',
      }),
      expect.objectContaining({
        title: owlCourse.title,
        platform: 'owlv2',
        status: 'no_data',
        assignmentCount: 0,
        message: expect.stringContaining(
          'assignment extraction is not supported'
        ),
      }),
    ]);
    expect(payload.aggregation.truncatedAssignments).toBe(false);
    expect(assignmentsSpy).toHaveBeenCalledTimes(1);
  });
});
