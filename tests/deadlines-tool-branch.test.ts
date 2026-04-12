import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { cache, getCacheKey, TTL } from '../src/cache/store';
import { scraper, SessionExpiredError } from '../src/scraper/eclass';
import { getDeadlines, getUpcomingDeadlines } from '../src/tools/deadlines';

let seq = 0;
const touchedCacheKeys = new Set<string>();

function nextCourseId(tag: string): string {
  seq += 1;
  return `vitest-deadlines-${process.pid}-${Date.now()}-${tag}-${seq}`;
}

function rememberKey(key: string): string {
  touchedCacheKeys.add(key);
  return key;
}

function parsePayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function mkAssignment(
  id: string,
  url: string,
  dueDate = '2026-03-15T12:00:00.000Z'
) {
  return {
    id,
    name: `Assignment ${id}`,
    dueDate,
    status: 'open',
    courseId: '101',
    url,
  };
}

function mkDeadlineItem(
  id: string,
  url: string,
  dueDate: string,
  type: 'assign' | 'quiz' | 'other' = 'assign'
) {
  return {
    id,
    name: `Item ${id}`,
    dueDate,
    status: 'open',
    courseId: '101',
    url,
    type,
  };
}

afterEach(() => {
  for (const key of touchedCacheKeys) {
    cache.invalidate(key);
  }
  touchedCacheKeys.clear();
  vi.restoreAllMocks();
});

describe('deadlines tool branch behavior', () => {
  it('getUpcomingDeadlines returns cache miss then cache hit', async () => {
    const courseId = nextCourseId('upcoming-tool');
    rememberKey(getCacheKey('deadlines', 'upcoming', courseId));

    const deadlinesSpy = vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([
      mkAssignment('1', 'https://eclass.yorku.ca/mod/assign/view.php?id=11'),
    ] as any);

    const first = parsePayload(await getUpcomingDeadlines(30, courseId));
    expect(first._cache.hit).toBe(false);
    expect(first.items).toHaveLength(1);

    const second = parsePayload(await getUpcomingDeadlines(30, courseId));
    expect(second._cache.hit).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(deadlinesSpy).toHaveBeenCalledTimes(1);
  });

  it('getUpcomingDeadlines returns auth_required when session expires', async () => {
    const courseId = nextCourseId('upcoming-auth');
    rememberKey(getCacheKey('deadlines', 'upcoming', courseId));

    vi.spyOn(scraper, 'getDeadlines').mockRejectedValue(
      new SessionExpiredError('expired')
    );
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );

    const payload = parsePayload(await getUpcomingDeadlines(30, courseId));
    expect(payload.status).toBe('auth_required');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry?.authUrl).toBe('http://localhost:3000/auth');
    expect(openAuthSpy).toHaveBeenCalledTimes(1);
  });

  it('getDeadlines upcoming infers item type and caches follow-up calls', async () => {
    const courseId = nextCourseId('upcoming-scope');
    rememberKey(getCacheKey('deadlines', 'upcoming', courseId, ''));

    const deadlinesSpy = vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([
      mkAssignment('1', 'https://eclass.yorku.ca/mod/assign/view.php?id=11'),
      mkAssignment('2', 'https://eclass.yorku.ca/mod/quiz/view.php?id=22'),
      mkAssignment('3', 'https://example.org/reading-activity'),
    ] as any);

    const first = parsePayload(
      await getDeadlines({ scope: 'upcoming', courseId, includeDetails: false })
    );

    expect(first._cache.hit).toBe(false);
    expect(first.items.map((item: any) => item.type)).toEqual([
      'assign',
      'quiz',
      'other',
    ]);

    const second = parsePayload(
      await getDeadlines({ scope: 'upcoming', courseId, includeDetails: false })
    );

    expect(second._cache.hit).toBe(true);
    expect(deadlinesSpy).toHaveBeenCalledTimes(1);
  });

  it('getDeadlines month filters by month/year and caches result', async () => {
    const courseId = nextCourseId('month');
    const month = 3;
    const year = 2026;
    rememberKey(getCacheKey('deadlines', 'month', courseId, `${year}_${month}`));

    const monthSpy = vi
      .spyOn(scraper, 'getAllAssignmentDeadlines')
      .mockResolvedValue([
        mkDeadlineItem(
          'm1',
          'https://eclass.yorku.ca/mod/assign/view.php?id=1',
          '2026-03-31T12:00:00.000Z'
        ),
        mkDeadlineItem(
          'm2',
          'https://eclass.yorku.ca/mod/quiz/view.php?id=2',
          '2026-03-15T09:00:00.000Z',
          'quiz'
        ),
        mkDeadlineItem(
          'm3',
          'https://eclass.yorku.ca/mod/assign/view.php?id=3',
          '2026-04-15T12:00:00.000Z'
        ),
        mkDeadlineItem(
          'm4',
          'https://eclass.yorku.ca/mod/assign/view.php?id=4',
          'not-a-date'
        ),
      ] as any);

    const first = parsePayload(
      await getDeadlines({ scope: 'month', courseId, month, year })
    );
    expect(first._cache.hit).toBe(false);
    expect(first.items.map((item: any) => item.id)).toEqual(['m1', 'm2']);

    const second = parsePayload(
      await getDeadlines({ scope: 'month', courseId, month, year })
    );
    expect(second._cache.hit).toBe(true);
    expect(monthSpy).toHaveBeenCalledTimes(1);
  });

  it('getDeadlines month refetches when cached payload is empty', async () => {
    const courseId = nextCourseId('month-empty');
    const month = 5;
    const year = 2026;
    const key = rememberKey(
      getCacheKey('deadlines', 'month', courseId, `${year}_${month}`)
    );

    cache.set(key, [], TTL.DEADLINES);

    const monthSpy = vi
      .spyOn(scraper, 'getAllAssignmentDeadlines')
      .mockResolvedValue([
        mkDeadlineItem(
          'x1',
          'https://eclass.yorku.ca/mod/assign/view.php?id=91',
          '2026-05-20T00:00:00.000Z'
        ),
      ] as any);

    const payload = parsePayload(
      await getDeadlines({ scope: 'month', courseId, month, year })
    );

    expect(payload._cache.hit).toBe(false);
    expect(payload.items).toHaveLength(1);
    expect(monthSpy).toHaveBeenCalledTimes(1);
  });

  it('getDeadlines range filters, dedupes, and caches result', async () => {
    const courseId = nextCourseId('range');
    const from = '2026-03-01T00:00:00.000Z';
    const to = '2026-03-31T23:59:59.999Z';

    rememberKey(getCacheKey('deadlines', 'range', courseId, '2026-03-01_2026-03-31'));

    const rangeSpy = vi
      .spyOn(scraper, 'getAllAssignmentDeadlines')
      .mockResolvedValue([
        mkDeadlineItem(
          'r1',
          'https://eclass.yorku.ca/mod/assign/view.php?id=111',
          '2026-03-10T08:00:00.000Z'
        ),
        mkDeadlineItem(
          'r2',
          'https://eclass.yorku.ca/mod/assign/view.php?id=111',
          '2026-03-12T08:00:00.000Z'
        ),
        mkDeadlineItem('r3', '', '2026-03-15T08:00:00.000Z'),
        mkDeadlineItem('r3', '', '2026-03-16T08:00:00.000Z'),
        mkDeadlineItem(
          'r4',
          'https://eclass.yorku.ca/mod/assign/view.php?id=222',
          '2026-04-05T08:00:00.000Z'
        ),
        mkDeadlineItem(
          'r5',
          'https://eclass.yorku.ca/mod/assign/view.php?id=333',
          'bad-date'
        ),
      ] as any);

    const first = parsePayload(
      await getDeadlines({ scope: 'range', courseId, from, to })
    );

    expect(first._cache.hit).toBe(false);
    expect(first.items.map((item: any) => item.id)).toEqual(['r1', 'r3']);

    const second = parsePayload(
      await getDeadlines({ scope: 'range', courseId, from, to })
    );

    expect(second._cache.hit).toBe(true);
    expect(rangeSpy).toHaveBeenCalledTimes(1);
  });

  it('getDeadlines range returns structured validation errors for invalid boundaries', async () => {
    const payload = parsePayload(
      await getDeadlines({
        scope: 'range',
        courseId: nextCourseId('range-invalid'),
        from: 'bad-date',
        to: '2026-03-31',
      })
    );

    expect(payload.status).toBe('error');
    expect(payload.code).toBe('VALIDATION_FAILED');
  });

  it('getDeadlines includeDetails continues when per-item details fetch fails', async () => {
    const courseId = nextCourseId('details-fallback');
    rememberKey(getCacheKey('deadlines', 'upcoming', courseId, ''));

    const itemUrlA =
      'https://eclass.yorku.ca/mod/assign/view.php?id=detail-a';
    const itemUrlB =
      'https://eclass.yorku.ca/mod/quiz/view.php?id=detail-b';
    rememberKey(getCacheKey('details', 'v2', itemUrlA));
    rememberKey(getCacheKey('details', 'v2', itemUrlB));

    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([
      mkAssignment('d1', itemUrlA),
      mkAssignment('d2', itemUrlB),
    ] as any);

    const detailsSpy = vi
      .spyOn(scraper, 'getItemDetails')
      .mockImplementation(async (url: string) => {
        if (url === itemUrlA) {
          throw new Error('simulated item details failure');
        }
        return {
          kind: 'quiz',
          url,
          title: 'Quiz details',
        } as any;
      });

    const payload = parsePayload(
      await getDeadlines({
        scope: 'upcoming',
        courseId,
        includeDetails: true,
        maxDetails: 2,
      })
    );

    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].details).toBeUndefined();
    expect(payload.items[1].details?.kind).toBe('quiz');
    expect(detailsSpy).toHaveBeenCalledTimes(2);
  });

  it('getDeadlines includeDetails respects maxDetails lower bound', async () => {
    const courseId = nextCourseId('details-max');
    rememberKey(getCacheKey('deadlines', 'upcoming', courseId, ''));

    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([
      mkAssignment('z1', 'https://eclass.yorku.ca/mod/assign/view.php?id=z1'),
    ] as any);

    const detailsSpy = vi
      .spyOn(scraper, 'getItemDetails')
      .mockResolvedValue({ kind: 'assign' } as any);

    const payload = parsePayload(
      await getDeadlines({
        scope: 'upcoming',
        courseId,
        includeDetails: true,
        maxDetails: -10,
      })
    );

    expect(payload.items).toHaveLength(1);
    expect(detailsSpy).not.toHaveBeenCalled();
  });

  it('getDeadlines returns auth_required when scraper session expires', async () => {
    const courseId = nextCourseId('scope-auth');
    rememberKey(getCacheKey('deadlines', 'upcoming', courseId, ''));

    vi.spyOn(scraper, 'getDeadlines').mockRejectedValue(
      new SessionExpiredError('expired')
    );
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );

    const payload = parsePayload(
      await getDeadlines({ scope: 'upcoming', courseId })
    );

    expect(payload.status).toBe('auth_required');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry?.authUrl).toBe('http://localhost:3000/auth');
    expect(openAuthSpy).toHaveBeenCalledTimes(1);
  });
});
