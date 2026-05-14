import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCourseContent: vi.fn(),
  getSectionText: vi.fn(),
  getWithMeta: vi.fn(),
  set: vi.fn(),
  clearVolatile: vi.fn(),
  clearByPrefix: vi.fn(),
  handleEclassSessionExpired: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../src/scraper/eclass', () => {
  class SessionExpiredError extends Error {}
  return {
    scraper: {
      getCourseContent: mocks.getCourseContent,
      getSectionText: mocks.getSectionText,
    },
    SessionExpiredError,
  };
});

vi.mock('../src/cache/store', () => ({
  cache: {
    getWithMeta: mocks.getWithMeta,
    set: mocks.set,
    clearVolatile: mocks.clearVolatile,
    clearByPrefix: mocks.clearByPrefix,
  },
  TTL: { CONTENT: 30 },
  getCacheKey: (...parts: string[]) => parts.join(':'),
  attachCacheMeta: (
    data: Record<string, unknown>,
    meta: Record<string, unknown>
  ) => ({
    ...data,
    _cache: meta,
  }),
}));

vi.mock('../src/auth/server', () => ({
  getAuthUrl: () => 'http://localhost:3000/auth',
}));

vi.mock('../src/tools/auth-retry', () => ({
  handleEclassSessionExpired: mocks.handleEclassSessionExpired,
  isSessionStorageUnavailable: () => false,
  sessionStorageUnavailableResponse: vi.fn(),
}));

vi.mock('../src/logging/context', () => ({
  getLogger: () => ({ info: mocks.loggerInfo }),
}));

import { SessionExpiredError } from '../src/scraper/eclass';
import { clearCache } from '../src/tools/cache';
import { getCourseContent, getSectionText } from '../src/tools/content';

function payload(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0].text || '{}');
}

describe('content and cache tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWithMeta.mockReturnValue(null);
  });

  it('returns cached and fresh course content with cache metadata', async () => {
    mocks.getWithMeta.mockReturnValueOnce({
      data: { courseId: '143648', sections: [] },
      fetched_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-01T00:30:00.000Z',
      stale: true,
    });
    expect(payload(await getCourseContent('143648'))).toMatchObject({
      courseId: '143648',
      _cache: { hit: true, stale: true },
    });

    mocks.getCourseContent.mockResolvedValueOnce({
      courseId: '143649',
      sections: [{ title: 'Week 1' }],
    });
    const fresh = payload(await getCourseContent('143649'));
    expect(fresh).toMatchObject({
      courseId: '143649',
      _cache: { hit: false },
    });
    expect(mocks.set).toHaveBeenCalledWith(
      'content:143649',
      expect.objectContaining({ courseId: '143649' }),
      30
    );
  });

  it('sanitizes section URLs, returns cached section text, and retries auth errors', async () => {
    mocks.getWithMeta.mockReturnValueOnce({
      data: { url: 'https://eclass.test/section', text: 'cached' },
      fetched_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-01T00:30:00.000Z',
    });
    expect(
      payload(
        await getSectionText('https://eclass.test/section?forcedownload=1')
      )
    ).toMatchObject({
      text: 'cached',
      _cache: { hit: true },
    });

    const sessionError = new SessionExpiredError('expired');
    mocks.getWithMeta.mockReturnValueOnce(null);
    mocks.getSectionText.mockRejectedValueOnce(sessionError);
    mocks.handleEclassSessionExpired.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ status: 'handled' }) }],
    });
    expect(
      payload(await getSectionText('https://eclass.test/section?x=1'))
    ).toEqual({ status: 'handled' });
    expect(mocks.handleEclassSessionExpired).toHaveBeenCalledWith(
      sessionError,
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('clears each cache scope and reports errors', async () => {
    mocks.clearVolatile.mockReturnValue(4);
    expect(payload(await clearCache('volatile')).clearedCount).toBe(4);

    mocks.clearByPrefix.mockImplementation((prefix: string) => prefix.length);
    const scopes = [
      ['deadlines', 9],
      ['announcements', 13],
      ['grades', 6],
      ['content', 18],
      ['courses', 7],
      ['files', 4],
      ['rmp', 21],
      ['all', 0],
    ] as const;

    for (const [scope, expected] of scopes) {
      expect(payload(await clearCache(scope)).clearedCount).toBe(expected);
    }

    mocks.clearByPrefix.mockImplementationOnce(() => {
      throw new Error('disk denied');
    });
    const failed = await clearCache('all');
    expect(payload(failed).ok).toBe(false);
    expect((failed as any).isError).toBe(true);
  });
});
