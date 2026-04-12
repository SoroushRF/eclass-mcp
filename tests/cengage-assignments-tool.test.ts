import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { CACHE_SCHEMA_VERSION, cache, getCacheKey } from '../src/cache/store';
import { CengageScraper } from '../src/scraper/cengage';
import { CengageAuthRequiredError } from '../src/scraper/cengage-errors';
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
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
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
    expect(assignmentsSpy).toHaveBeenCalledWith(uniqueCourse.launchUrl);
  });

  it('supports legacy string input and returns selected course assignments', async () => {
    const entryUrl = uniqueEntryUrl('legacy');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([SAMPLE_COURSE]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([
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
      ]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments(entryUrl);
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload._cache).toBeDefined();
    expect(payload._cache.hit).toBe(false);
    expect(payload.selectedCourse.title).toBe('MATH 1010 - Calculus I');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.assignments[0].status).toBe('pending');

    expect(listSpy).toHaveBeenCalledWith(entryUrl);
    expect(assignmentsSpy).toHaveBeenCalledWith(SAMPLE_COURSE.launchUrl);
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
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
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
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl,
      courseQuery: 'MATH 1010 - Calculus II',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.selectedCourse.title).toBe('MATH 1010 - Calculus II');
    expect(assignmentsSpy).toHaveBeenCalledWith(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1002'
    );
  });

  it('returns no_data when selectors do not match any course', async () => {
    const entryUrl = uniqueEntryUrl('not-found');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
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
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
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
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
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
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockImplementation(async (launchUrl: string) => {
        if (launchUrl === courseA.launchUrl) {
          return [
            {
              id: 'asg-a-1',
              name: 'A1',
              dueDate: '2026-04-15 23:59',
              status: 'Pending',
              courseId: courseA.courseId,
              courseTitle: courseA.title,
              rawText: 'A1 Due Date',
            } as any,
          ];
        }

        return [
          {
            id: 'asg-b-1',
            name: 'B1',
            dueDate: '2026-04-18 23:59',
            status: 'Submitted',
            courseId: courseB.courseId,
            courseTitle: courseB.title,
            rawText: 'B1 Due Date',
          } as any,
        ];
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
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([
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
      ]);

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
});
