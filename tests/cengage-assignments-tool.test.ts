import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('get cengage assignments tool on new core', () => {
  it('returns error when entry URL is missing (link-first baseline)', async () => {
    const result = await getCengageAssignments({} as any);
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('error');
    expect(payload.assignments).toHaveLength(0);
    expect(payload.message).toContain('entryUrl or ssoUrl is required');
  });

  it('supports legacy string input and returns selected course assignments', async () => {
    const entryUrl = uniqueEntryUrl('legacy');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCourses')
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
      'listDashboardCourses'
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
      'listDashboardCourses'
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
      'listDashboardCourses'
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
      'listDashboardCourses'
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
      .spyOn(CengageScraper.prototype, 'listDashboardCourses')
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
});
