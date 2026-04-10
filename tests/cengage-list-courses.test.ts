import { afterEach, describe, expect, it, vi } from 'vitest';
import { CengageScraper } from '../src/scraper/cengage';
import { CengageAuthRequiredError } from '../src/scraper/cengage-errors';
import { listCengageCourses } from '../src/tools/cengage';

const SAMPLE_COURSES = [
  {
    courseId: 'math-1010',
    courseKey: 'WA-production-1001',
    title: 'MATH 1010 - Calculus I',
    launchUrl:
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
    platform: 'webassign' as const,
    confidence: 0.95,
  },
  {
    courseId: 'math-1020',
    courseKey: 'WA-production-1002',
    title: 'MATH 1010 - Calculus II',
    launchUrl:
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1002',
    platform: 'webassign' as const,
    confidence: 0.92,
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('list cengage courses tool', () => {
  it('lists courses from entry URL', async () => {
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCourses')
      .mockResolvedValue(SAMPLE_COURSES);
    const closeSpy = vi
      .spyOn(CengageScraper.prototype, 'close')
      .mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl: 'https://www.cengage.com/dashboard/home',
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('ok');
    expect(payload.courses).toHaveLength(2);
    expect(listSpy).toHaveBeenCalledWith(
      'https://www.cengage.com/dashboard/home'
    );
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('uses discovered link normalized URL when provided', async () => {
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCourses')
      .mockResolvedValue(SAMPLE_COURSES);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl: 'https://placeholder.example/path',
      discoveredLink: {
        rawUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001#frag',
        normalizedUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
        linkType: 'webassign_course',
        source: 'manual',
      },
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('ok');
    expect(listSpy).toHaveBeenCalledWith(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001'
    );
  });

  it('returns needs_course_selection for ambiguous courseQuery', async () => {
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockResolvedValue(SAMPLE_COURSES);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl: 'https://www.cengage.com/dashboard/home',
      courseQuery: 'math 1010 calculus',
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('needs_course_selection');
    expect(payload.courses.length).toBeGreaterThan(1);
  });

  it('returns no_data when query matches no courses', async () => {
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockResolvedValue(SAMPLE_COURSES);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl: 'https://www.cengage.com/dashboard/home',
      courseQuery: 'biology 5000',
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('no_data');
    expect(payload.courses).toHaveLength(0);
  });

  it('maps auth required errors to auth_required status', async () => {
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockRejectedValue(new CengageAuthRequiredError('Auth required'));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl: 'https://www.cengage.com/dashboard/home',
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('auth_required');
    expect(payload.message).toContain('Please log in at');
  });
});
