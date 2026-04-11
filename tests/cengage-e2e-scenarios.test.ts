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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cengage T23 scenario coverage', () => {
  it('scenario: direct dashboard link lists courses', async () => {
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

  it('scenario: direct course link returns assignments', async () => {
    const directCourseUrl = uniqueUrl(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
      'course'
    );

    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([{ ...SAMPLE_COURSE, launchUrl: directCourseUrl }]);

    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([
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
      ]);

    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({ entryUrl: directCourseUrl });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.selectedCourse.launchUrl).toBe(directCourseUrl);
    expect(payload.assignments).toHaveLength(1);
    expect(payload.assignments[0].name).toBe('Homework 1');
    expect(listSpy).toHaveBeenCalledWith(directCourseUrl);
    expect(assignmentsSpy).toHaveBeenCalledWith(directCourseUrl);
  });

  it('scenario: auth-expired recovery returns auth_required and retry guidance', async () => {
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
