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

function uniqueEntryUrl(tag: string): string {
  return `https://www.cengage.com/dashboard/home?test=${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('list cengage courses tool', () => {
  it('lists courses from entry URL', async () => {
    const entryUrl = uniqueEntryUrl('list');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCourses')
      .mockResolvedValue(SAMPLE_COURSES);
    const closeSpy = vi
      .spyOn(CengageScraper.prototype, 'close')
      .mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('ok');
    expect(payload.courses).toHaveLength(2);
    expect(payload._cache).toBeDefined();
    expect(payload._cache.hit).toBe(false);
    expect(listSpy).toHaveBeenCalledWith(entryUrl);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('uses discovered link normalized URL when provided', async () => {
    const entryUrl = uniqueEntryUrl('discovered');
    const discoveredCourseKey = `WA-production-discovered-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const discoveredUrl = `https://www.webassign.net/v4cgi/login.pl?courseKey=${discoveredCourseKey}`;
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCourses')
      .mockResolvedValue(SAMPLE_COURSES);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl,
      discoveredLink: {
        rawUrl: `${discoveredUrl}#frag`,
        normalizedUrl: discoveredUrl,
        linkType: 'webassign_course',
        source: 'manual',
      },
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('ok');
    expect(listSpy).toHaveBeenCalledWith(discoveredUrl);
  });

  it('returns needs_course_selection for ambiguous courseQuery', async () => {
    const entryUrl = uniqueEntryUrl('ambiguous');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockResolvedValue(SAMPLE_COURSES);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl,
      courseQuery: 'math 1010 calculus',
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('needs_course_selection');
    expect(payload.courses.length).toBeGreaterThan(1);
  });

  it('returns no_data when query matches no courses', async () => {
    const entryUrl = uniqueEntryUrl('no-data');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockResolvedValue(SAMPLE_COURSES);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl,
      courseQuery: 'biology 5000',
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('no_data');
    expect(payload.courses).toHaveLength(0);
  });

  it('maps auth required errors to auth_required status', async () => {
    const entryUrl = uniqueEntryUrl('auth');
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCourses'
    ).mockRejectedValue(new CengageAuthRequiredError('Auth required'));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      entryUrl,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.status).toBe('auth_required');
    expect(payload.message).toContain('Please log in at');
  });

  it('serves repeat identical requests from cache', async () => {
    const entryUrl = uniqueEntryUrl('cache-hit');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCourses')
      .mockResolvedValue(SAMPLE_COURSES);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const first = await listCengageCourses({ entryUrl });
    const firstPayload = JSON.parse(first.content[0].text);
    expect(firstPayload._cache.hit).toBe(false);

    const second = await listCengageCourses({ entryUrl });
    const secondPayload = JSON.parse(second.content[0].text);
    expect(secondPayload._cache.hit).toBe(true);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });
});
