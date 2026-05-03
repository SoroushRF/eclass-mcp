import fs from 'fs';
import path from 'path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as authServer from '../src/auth/server';
import {
  getPinsFilePath,
  invalidatePinsMemoryCache,
  upsertPin,
} from '../src/cache/pins';
import { cache, getCacheKey } from '../src/cache/store';
import { scraper, SessionExpiredError } from '../src/scraper/eclass';
import { cacheRefreshPin } from '../src/tools/pins';

const pinsFilePath = getPinsFilePath();
let originalPinsFileContent: string | null = null;

function parsePayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function seedContentPin(pinId: string, courseId: string) {
  upsertPin({
    pinId,
    resource_type: 'content',
    resource_key: courseId,
    cacheKey: getCacheKey('content', courseId),
    pinned_at: new Date().toISOString(),
  });
}

function cleanupPinsFile() {
  invalidatePinsMemoryCache();
  if (fs.existsSync(pinsFilePath)) {
    fs.unlinkSync(pinsFilePath);
  }
}

beforeAll(() => {
  if (fs.existsSync(pinsFilePath)) {
    originalPinsFileContent = fs.readFileSync(pinsFilePath, 'utf-8');
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  cache.invalidate(getCacheKey('content', 'auth-timeout-course'));
  cache.invalidate(getCacheKey('content', 'auth-retry-course'));
  cleanupPinsFile();
});

afterAll(() => {
  cleanupPinsFile();
  if (originalPinsFileContent !== null) {
    fs.mkdirSync(path.dirname(pinsFilePath), { recursive: true });
    fs.writeFileSync(pinsFilePath, originalPinsFileContent, 'utf-8');
    invalidatePinsMemoryCache();
  }
});

describe('cache_refresh_pin auth retry behavior', () => {
  it('does not report refreshed when the underlying tool returns auth_required', async () => {
    seedContentPin('pin-auth-timeout', 'auth-timeout-course');
    vi.spyOn(scraper, 'getCourseContent').mockRejectedValue(
      new SessionExpiredError('expired')
    );
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(false);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );

    const payload = parsePayload(
      await cacheRefreshPin({ pinId: 'pin-auth-timeout' })
    );

    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('session_expired');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry.authUrl).toBe('http://localhost:3000/auth');
  });

  it('reports refreshed when auth completes and the underlying retry succeeds', async () => {
    seedContentPin('pin-auth-retry', 'auth-retry-course');
    const contentSpy = vi
      .spyOn(scraper, 'getCourseContent')
      .mockRejectedValueOnce(new SessionExpiredError('expired'))
      .mockResolvedValueOnce({
        courseId: 'auth-retry-course',
        sections: [],
      } as any);
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(true);

    const payload = parsePayload(
      await cacheRefreshPin({ pinId: 'pin-auth-retry' })
    );

    expect(payload.ok).toBe(true);
    expect(payload.refreshed).toBe(true);
    expect(contentSpy).toHaveBeenCalledTimes(2);
  });
});
