import fs from 'fs';
import path from 'path';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pins from '../src/cache/pins';
import {
  CACHE_SCHEMA_VERSION,
  TTL,
  attachCacheMeta,
  CACHE_DIR,
  cache,
  clearCengageCacheArtifacts,
  getCacheFilePathForKey,
  getCacheKey,
  sanitizeCacheKeyForFilename,
  isCacheEntryExpired,
} from '../src/cache/store';
import { clearCache } from '../src/tools/cache';
import {
  resetCacheMetricsForTests,
  snapshotCacheMetrics,
} from '../src/cache/metrics';

const touchedFiles = new Set<string>();

function writeEntryFile(key: string, entry: Record<string, unknown>): string {
  const filePath = getCacheFilePathForKey(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  touchedFiles.add(filePath);
  return filePath;
}

function parseToolPayload(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0].text || '{}');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const filePath of touchedFiles) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  touchedFiles.clear();
  resetCacheMetricsForTests();
});

describe('cache TTL constants', () => {
  it('uses tiered minute-based positive TTLs', () => {
    expect(TTL.COURSES).toBe(360); // 6h
    expect(TTL.CONTENT).toBe(180); // 3h
    expect(TTL.DEADLINES).toBe(30); // 30m
    expect(TTL.GRADES).toBe(180); // 3h
    expect(TTL.FILES).toBe(2880); // 48h
  });
});

describe('cache key + expiry helpers', () => {
  it('sanitizes keys for filenames', () => {
    expect(sanitizeCacheKeyForFilename('deadlines:foo/bar')).toBe(
      'deadlines_foo_bar'
    );
    expect(sanitizeCacheKeyForFilename('plain_key')).toBe('plain_key');
  });

  it('keeps arbitrary cache filenames within the portable safe alphabet', () => {
    fc.assert(
      fc.property(fc.string(), (key) => {
        const sanitized = sanitizeCacheKeyForFilename(key);
        expect(sanitized).toMatch(/^[a-z0-9_-]*$/i);
        expect(sanitizeCacheKeyForFilename(sanitized)).toBe(sanitized);
      })
    );
  });

  it('generates schema-versioned cache keys for arbitrary segments', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 5 }), (segments) => {
        const key = getCacheKey('vitest-prefix', ...segments);
        expect(key.startsWith(`v${CACHE_SCHEMA_VERSION}:vitest-prefix`)).toBe(
          true
        );
      })
    );
  });

  it('detects expired cache entries', () => {
    const past = '2020-01-01T00:00:00.000Z';
    const future = '2035-01-01T00:00:00.000Z';
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(isCacheEntryExpired(past, now)).toBe(true);
    expect(isCacheEntryExpired(future, now)).toBe(false);
  });

  it('attaches cache metadata for arrays, objects, and primitives', () => {
    const meta = {
      hit: true,
      fetched_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-01T01:00:00.000Z',
    };

    expect(attachCacheMeta([{ id: 1 }], meta)).toEqual({
      items: [{ id: 1 }],
      _cache: meta,
    });

    expect(attachCacheMeta({ id: 2, name: 'x' }, meta)).toEqual({
      id: 2,
      name: 'x',
      _cache: meta,
    });

    expect(attachCacheMeta('value', meta)).toEqual({
      value: 'value',
      _cache: meta,
    });
  });

  it('clears all Cengage cache artifact prefixes', () => {
    const clearSpy = vi
      .spyOn(cache, 'clearByPrefix')
      .mockImplementation(() => 1);

    const cleared = clearCengageCacheArtifacts();

    expect(cleared).toBe(6);
    expect(clearSpy).toHaveBeenCalledWith(
      `v${CACHE_SCHEMA_VERSION}:cengage:dashboard_inventory`
    );
    expect(clearSpy).toHaveBeenCalledWith(
      `v${CACHE_SCHEMA_VERSION}:cengage:list_courses`
    );
    expect(clearSpy).toHaveBeenCalledWith(
      `v${CACHE_SCHEMA_VERSION}:cengage:assignments`
    );
    expect(clearSpy).toHaveBeenCalledWith('cengage:dashboard_inventory');
    expect(clearSpy).toHaveBeenCalledWith('cengage:list_courses');
    expect(clearSpy).toHaveBeenCalledWith('cengage:assignments');

    clearSpy.mockRestore();
  });

  it('writes and reads cache entries with metadata', () => {
    const key = getCacheKey('vitest-cache', 'set-get');
    const filePath = getCacheFilePathForKey(key);
    touchedFiles.add(filePath);

    cache.set(key, { ok: true }, 5);
    const got = cache.getWithMeta<{ ok: boolean }>(key);

    expect(got).not.toBeNull();
    expect(got?.data).toEqual({ ok: true });
    expect(got?.version).toBe(CACHE_SCHEMA_VERSION);
    expect(typeof got?.fetched_at).toBe('string');
    expect(typeof got?.expires_at).toBe('string');
  });

  it('returns stale entry when expired key is pinned', () => {
    const key = getCacheKey('vitest-cache', 'expired-pinned');
    const filePath = writeEntryFile(key, {
      expires_at: '2020-01-01T00:00:00.000Z',
      fetched_at: '2019-12-31T23:00:00.000Z',
      data: { value: 1 },
      version: CACHE_SCHEMA_VERSION,
    });

    vi.spyOn(pins, 'isCacheKeyPinned').mockReturnValue(true);

    const got = cache.getWithMeta<{ value: number }>(key);
    expect(got?.stale).toBe(true);
    expect(got?.data.value).toBe(1);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('invalidates expired entry when it is not pinned', () => {
    const key = getCacheKey('vitest-cache', 'expired-unpinned');
    const filePath = writeEntryFile(key, {
      expires_at: '2020-01-01T00:00:00.000Z',
      fetched_at: '2019-12-31T23:00:00.000Z',
      data: { value: 1 },
      version: CACHE_SCHEMA_VERSION,
    });

    vi.spyOn(pins, 'isCacheKeyPinned').mockReturnValue(false);

    const got = cache.getWithMeta<{ value: number }>(key);
    expect(got).toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('invalidates cache entries when schema version mismatches', () => {
    const key = getCacheKey('vitest-cache', 'version-mismatch');
    const filePath = writeEntryFile(key, {
      expires_at: '2035-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: { value: 7 },
      version: CACHE_SCHEMA_VERSION + 999,
    });

    const got = cache.getWithMeta<{ value: number }>(key);
    expect(got).toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('clearByPrefix skips pinned filenames and ignores non-json files', () => {
    const prefix = getCacheKey('vitest-clear-prefix');

    const removableKey = `${prefix}:removable`;
    const pinnedKey = `${prefix}:pinned`;
    const unrelatedKey = getCacheKey('vitest-clear-other', 'keep');

    const removableFile = writeEntryFile(removableKey, {
      expires_at: '2030-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: {},
      version: CACHE_SCHEMA_VERSION,
    });
    const pinnedFile = writeEntryFile(pinnedKey, {
      expires_at: '2030-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: {},
      version: CACHE_SCHEMA_VERSION,
    });
    const unrelatedFile = writeEntryFile(unrelatedKey, {
      expires_at: '2030-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: {},
      version: CACHE_SCHEMA_VERSION,
    });

    const txtFile = path.join(
      CACHE_DIR,
      `${sanitizeCacheKeyForFilename(prefix)}.txt`
    );
    fs.writeFileSync(txtFile, 'keep-me', 'utf-8');
    touchedFiles.add(txtFile);

    vi.spyOn(pins, 'getPinnedCacheFilenames').mockReturnValue(
      new Set([path.basename(pinnedFile)])
    );

    const cleared = cache.clearByPrefix(prefix);
    expect(cleared).toBe(1);
    expect(fs.existsSync(removableFile)).toBe(false);
    expect(fs.existsSync(pinnedFile)).toBe(true);
    expect(fs.existsSync(unrelatedFile)).toBe(true);
    expect(fs.existsSync(txtFile)).toBe(true);
  });

  it('isolates scoped eClass account clearing', () => {
    const accountAKey = getCacheKey(
      'eclass',
      'acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'courses',
      'all'
    );
    const accountBKey = getCacheKey(
      'eclass',
      'acct_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'courses',
      'all'
    );
    const accountAFile = writeEntryFile(accountAKey, {
      expires_at: '2030-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: {},
      version: CACHE_SCHEMA_VERSION,
    });
    const accountBFile = writeEntryFile(accountBKey, {
      expires_at: '2030-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: {},
      version: CACHE_SCHEMA_VERSION,
    });

    expect(
      cache.clearEclassAccountScope('acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    ).toBe(1);
    expect(fs.existsSync(accountAFile)).toBe(false);
    expect(fs.existsSync(accountBFile)).toBe(true);
  });

  it('clearVolatile clears versioned and legacy volatile prefixes', () => {
    const clearSpy = vi
      .spyOn(cache, 'clearByPrefix')
      .mockImplementation(() => 1);

    const total = cache.clearVolatile();
    expect(total).toBe(6);

    expect(clearSpy).toHaveBeenCalledWith(`v${CACHE_SCHEMA_VERSION}:deadlines`);
    expect(clearSpy).toHaveBeenCalledWith('deadlines');
    expect(clearSpy).toHaveBeenCalledWith(
      `v${CACHE_SCHEMA_VERSION}:announcements`
    );
    expect(clearSpy).toHaveBeenCalledWith('announcements');
    expect(clearSpy).toHaveBeenCalledWith(`v${CACHE_SCHEMA_VERSION}:grades`);
    expect(clearSpy).toHaveBeenCalledWith('grades');
  });

  it('clearCache removes versioned and legacy scoped keys', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'v1_deadlines_upcoming_vitest-clear.json',
      'deadlines_legacy-vitest-clear.json',
      'v1_grades_vitest-clear.json',
    ] as any);
    vi.spyOn(pins, 'getPinnedCacheFilenames').mockReturnValue(new Set());
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      return undefined;
    });

    const result = parseToolPayload(await clearCache('deadlines'));

    expect(result.clearedCount).toBe(2);
    expect(unlinkSpy).toHaveBeenCalledWith(
      path.join(CACHE_DIR, 'v1_deadlines_upcoming_vitest-clear.json')
    );
    expect(unlinkSpy).toHaveBeenCalledWith(
      path.join(CACHE_DIR, 'deadlines_legacy-vitest-clear.json')
    );
    expect(unlinkSpy).not.toHaveBeenCalledWith(
      path.join(CACHE_DIR, 'v1_grades_vitest-clear.json')
    );
  });

  it('clear removes non-pinned JSON files only', () => {
    const pinnedName = 'pinned.json';
    const normalName = 'normal.json';
    const nonJsonName = 'notes.txt';

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      pinnedName,
      normalName,
      nonJsonName,
    ] as any);

    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      return undefined;
    });

    vi.spyOn(pins, 'getPinnedCacheFilenames').mockReturnValue(
      new Set([pinnedName])
    );

    cache.clear();

    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).toHaveBeenCalledWith(path.join(CACHE_DIR, normalName));
  });

  it('records cache get hit, miss, stale pinned, expiry, and schema metrics', () => {
    resetCacheMetricsForTests();
    const freshKey = getCacheKey('vitest-cache', 'fresh-metrics');
    const staleKey = getCacheKey('vitest-cache', 'stale-metrics');
    const expiredKey = getCacheKey('vitest-cache', 'expired-metrics');
    const mismatchKey = getCacheKey('vitest-cache', 'mismatch-metrics');

    writeEntryFile(freshKey, {
      expires_at: '2035-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: { value: 1 },
      version: CACHE_SCHEMA_VERSION,
    });
    writeEntryFile(staleKey, {
      expires_at: '2020-01-01T00:00:00.000Z',
      fetched_at: '2019-12-31T23:00:00.000Z',
      data: { value: 2 },
      version: CACHE_SCHEMA_VERSION,
    });
    writeEntryFile(expiredKey, {
      expires_at: '2020-01-01T00:00:00.000Z',
      fetched_at: '2019-12-31T23:00:00.000Z',
      data: { value: 3 },
      version: CACHE_SCHEMA_VERSION,
    });
    writeEntryFile(mismatchKey, {
      expires_at: '2035-01-01T00:00:00.000Z',
      fetched_at: '2026-01-01T00:00:00.000Z',
      data: { value: 4 },
      version: CACHE_SCHEMA_VERSION + 1,
    });

    vi.spyOn(pins, 'isCacheKeyPinned').mockImplementation(
      (key) => key === staleKey
    );

    expect(
      cache.getWithMeta(getCacheKey('vitest-cache', 'missing'))
    ).toBeNull();
    expect(cache.getWithMeta(freshKey)).not.toBeNull();
    expect(cache.getWithMeta(staleKey)?.stale).toBe(true);
    expect(cache.getWithMeta(expiredKey)).toBeNull();
    expect(cache.getWithMeta(mismatchKey)).toBeNull();

    expect(snapshotCacheMetrics().counters).toMatchObject({
      get_miss: 1,
      get_hit: 1,
      get_stale_pinned_hit: 1,
      expired_unpinned_invalidated: 1,
      schema_mismatch_invalidated: 1,
    });
  });

  it('records cache write and invalidate metrics', () => {
    resetCacheMetricsForTests();
    const key = getCacheKey('vitest-cache', 'write-metrics');
    const filePath = getCacheFilePathForKey(key);
    touchedFiles.add(filePath);

    cache.set(key, { ok: true }, 5);
    cache.invalidate(key);
    cache.invalidate(getCacheKey('vitest-cache', 'missing-invalidate'));

    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('write failed');
    });
    cache.set(getCacheKey('vitest-cache', 'write-error'), { ok: false }, 5);

    expect(snapshotCacheMetrics().counters).toMatchObject({
      write_success: 1,
      write_error: 1,
      invalidate_deleted: 1,
      invalidate_miss: 1,
    });
  });

  it('records clear metrics for deleted, skipped, and failed clears', () => {
    resetCacheMetricsForTests();
    const pinnedName = 'pinned.json';
    const normalName = 'normal.json';

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      pinnedName,
      normalName,
    ] as any);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
    vi.spyOn(pins, 'getPinnedCacheFilenames').mockReturnValue(
      new Set([pinnedName])
    );

    expect(cache.clearByPrefix('')).toBe(1);

    vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('readdir failed');
    });
    expect(cache.clearByPrefix('')).toBe(0);

    expect(snapshotCacheMetrics().counters).toMatchObject({
      clear_deleted: 1,
      clear_pinned_skipped: 1,
      clear_error: 1,
    });
  });
});
