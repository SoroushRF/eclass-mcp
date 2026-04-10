import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('get cengage assignments tool on new core', () => {
  it('supports legacy string input and returns selected course assignments', async () => {
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

    const result = await getCengageAssignments(
      'https://www.cengage.com/dashboard/home'
    );
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.selectedCourse.title).toBe('MATH 1010 - Calculus I');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.assignments[0].status).toBe('pending');

    expect(listSpy).toHaveBeenCalledWith(
      'https://www.cengage.com/dashboard/home'
    );
    expect(assignmentsSpy).toHaveBeenCalledWith(SAMPLE_COURSE.launchUrl);
  });

  it('returns needs_course_selection when multiple courses exist without selector', async () => {
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
      entryUrl: 'https://www.cengage.com/dashboard/home',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('needs_course_selection');
    expect(payload.assignments).toHaveLength(0);
    expect(assignmentsSpy).not.toHaveBeenCalled();
  });

  it('uses courseQuery to resolve and fetch assignments from selected course', async () => {
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
      entryUrl: 'https://www.cengage.com/dashboard/home',
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
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockResolvedValue([SAMPLE_COURSE]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignments')
      .mockResolvedValue([]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl: 'https://www.cengage.com/dashboard/home',
      courseId: 'missing-course',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.assignments).toHaveLength(0);
    expect(assignmentsSpy).not.toHaveBeenCalled();
  });

  it('maps auth-required errors to auth_required status', async () => {
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockRejectedValue(new CengageAuthRequiredError('Auth required'));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignments({
      entryUrl: 'https://www.cengage.com/dashboard/home',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('auth_required');
    expect(payload.message).toContain('Please log in at');
  });
});
