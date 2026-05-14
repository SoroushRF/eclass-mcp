import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { CengageScraper } from '../src/scraper/cengage';
import { CengageAuthRequiredError } from '../src/scraper/cengage-errors';
import {
  getCengageAssignments,
  listCengageCourses,
} from '../src/tools/cengage';

const SAMPLE_COURSE = {
  courseId: 'math-1010',
  courseKey: 'WA-production-1001',
  title: 'MATH 1010 - Calculus I',
  launchUrl:
    'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
  platform: 'webassign' as const,
  confidence: 0.95,
};

function uniqueUrl(base: string, tag: string) {
  return `${base}?scenario=${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function uniqueWebAssignUrl(tag: string) {
  return `https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001&scenario=${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cengage mocked tool-contract scenarios (T23 baseline)', () => {
  it('mocked scenario: direct dashboard link lists courses', async () => {
    const entryUrl = uniqueUrl(
      'https://www.cengage.com/dashboard/home',
      'dashboard'
    );

    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([SAMPLE_COURSE]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({ entryUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.courses).toHaveLength(1);
    expect(payload.courses[0].launchUrl).toBe(SAMPLE_COURSE.launchUrl);
    expect(listSpy).toHaveBeenCalledWith(entryUrl);
  });

  it('mocked scenario: direct course link returns assignments', async () => {
    const directCourseUrl = uniqueWebAssignUrl('course');
    const listSpy = vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    );

    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsWithContext')
      .mockResolvedValue(withContext([
        {
          id: 'asg-1001',
          name: 'Homework 1',
          dueDate: '2026-04-20 23:59',
          dueDateIso: '2026-04-20T23:59:00',
          status: 'Pending',
          score: undefined,
          courseId: SAMPLE_COURSE.courseId,
          courseTitle: SAMPLE_COURSE.title,
          url: '/assignment/1001',
          rawText: 'Homework 1 Due Date Apr 20, 2026 11:59 PM',
        },
      ]));

    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({ entryUrl: directCourseUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.selectedCourse.courseKey).toBe(SAMPLE_COURSE.courseKey);
    expect(payload.assignments).toHaveLength(1);
    expect(payload.assignments[0].name).toBe('Homework 1');
    expect(listSpy).not.toHaveBeenCalled();
    expect(assignmentsSpy).toHaveBeenCalledWith(
      directCourseUrl,
      expect.objectContaining({
        expectedCourse: expect.objectContaining({
          courseKey: SAMPLE_COURSE.courseKey,
        }),
      })
    );
  });

  it('mocked scenario: auth-expired recovery returns auth_required and retry guidance', async () => {
    const entryUrl = uniqueUrl(
      'https://www.cengage.com/dashboard/home',
      'auth-expired'
    );

    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => {});

    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockRejectedValue(
      new CengageAuthRequiredError('Cengage session is stale.', {
        sessionReason: 'stale',
      })
    );

    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({ entryUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('auth_required');
    expect(payload.retry.afterAuth).toBe(true);
    expect(payload.retry.reason).toBe('session_stale');
    expect(payload.retry.authUrl).toContain('/auth-cengage');
    expect(payload.retry.input.entryUrl).toBe(entryUrl);
    expect(openAuthSpy).toHaveBeenCalledWith('cengage');
  });
});
