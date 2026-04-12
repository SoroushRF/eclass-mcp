import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { CACHE_SCHEMA_VERSION, cache, getCacheKey } from '../src/cache/store';
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

describe('list cengage courses tool', () => {
  it('supports dashboard-first mode without entry URL', async () => {
    isolateDashboardInventoryCache();

    const uniqueCourse = {
      ...SAMPLE_COURSES[0],
      title: `Dashboard Bootstrap ${Date.now()}`,
    };

    const sessionListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromSavedSession')
      .mockResolvedValue([uniqueCourse]);
    const entryListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([uniqueCourse]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
      courseQuery: uniqueCourse.title,
    } as any);
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.courses).toHaveLength(1);
    expect(payload.courses[0].title).toBe(uniqueCourse.title);
    expect(sessionListSpy).toHaveBeenCalledTimes(1);
    expect(entryListSpy).not.toHaveBeenCalled();
  });

  it('lists courses from entry URL', async () => {
    const entryUrl = uniqueEntryUrl('list');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
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
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
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
      'listDashboardCoursesFromEntryLink'
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
      'listDashboardCoursesFromEntryLink'
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
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => {});
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockRejectedValue(new CengageAuthRequiredError('Auth required'));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await listCengageCourses({
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

  it('serves repeat identical requests from cache', async () => {
    const entryUrl = uniqueEntryUrl('cache-hit');
    const listSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
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

  it('reuses dashboard inventory cache across no-entry query variants', async () => {
    isolateDashboardInventoryCache();

    const courseA = {
      ...SAMPLE_COURSES[0],
      title: `Inventory Cache A ${Date.now()}`,
    };
    const courseB = {
      ...SAMPLE_COURSES[1],
      title: `Inventory Cache B ${Date.now()}`,
    };

    const sessionListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromSavedSession')
      .mockResolvedValue([courseA, courseB]);
    const entryListSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromEntryLink')
      .mockResolvedValue([courseA, courseB]);
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const first = await listCengageCourses({
      courseQuery: courseA.title,
    } as any);
    const firstPayload = JSON.parse(first.content[0].text);
    expect(firstPayload.status).toBe('ok');
    expect(firstPayload.courses[0].title).toBe(courseA.title);

    const second = await listCengageCourses({
      courseQuery: courseB.title,
    } as any);
    const secondPayload = JSON.parse(second.content[0].text);
    expect(secondPayload.status).toBe('ok');
    expect(secondPayload.courses[0].title).toBe(courseB.title);

    expect(sessionListSpy).toHaveBeenCalledTimes(1);
    expect(entryListSpy).not.toHaveBeenCalled();
  });
});
