import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCacheHealth } from '../src/cache/health';
import { getCacheKey, sanitizeCacheKeyForFilename } from '../src/cache/store';
import { snapshotCacheMetrics } from '../src/cache/metrics';
import { cacheHealth } from '../src/tools/cache';

const tempRoots = new Set<string>();

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eclass-cache-health-'));
  tempRoots.add(root);
  return root;
}

function cacheFileName(cacheKey: string): string {
  return `${sanitizeCacheKeyForFilename(cacheKey)}.json`;
}

function writeCacheEntry(
  cacheDir: string,
  cacheKey: string,
  entry: Record<string, unknown>
): string {
  fs.mkdirSync(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, cacheFileName(cacheKey));
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  return filePath;
}

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe('collectCacheHealth', () => {
  it('reports a missing cache directory without creating or mutating it', () => {
    const root = makeTempRoot();
    const cacheDir = path.join(root, 'missing-cache');

    const health = collectCacheHealth({
      cacheDir,
      pins: [],
      pinsFilePath: path.join(root, 'missing-pins.json'),
      pinQuotaLimitBytes: 1024,
      pinnedBytes: 0,
      now: new Date('2026-05-19T00:00:00.000Z'),
    });

    expect(health.ok).toBe(true);
    expect(health.cache.totals.total_files).toBe(0);
    expect(health.pins.pins_file_status).toBe('missing');
    expect(health.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CACHE_DIR_MISSING' }),
      ])
    );
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it('aggregates cache files, pins, quota, and warnings without leaking names', () => {
    const root = makeTempRoot();
    const cacheDir = path.join(root, 'cache');
    const pinsFilePath = path.join(root, 'pins.json');
    const now = new Date('2026-05-19T00:00:00.000Z');
    const fresh = '2026-05-20T00:00:00.000Z';
    const expired = '2020-01-01T00:00:00.000Z';

    const validKey = getCacheKey('deadlines', 'upcoming', 'course-1');
    const expiredKey = getCacheKey('grades', 'course-1');
    const stalePinnedKey = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/secret.pdf?token=abc'
    );
    const mismatchKey = getCacheKey('content', 'course-2');
    const missingPinnedKey = getCacheKey(
      'sectiontext',
      'https://eclass.yorku.ca/course/view.php?id=secret'
    );

    writeCacheEntry(cacheDir, validKey, {
      expires_at: fresh,
      fetched_at: '2026-05-18T00:00:00.000Z',
      data: { ok: true },
      version: 1,
    });
    const expiredFile = writeCacheEntry(cacheDir, expiredKey, {
      expires_at: expired,
      fetched_at: '2020-01-01T00:00:00.000Z',
      data: { ok: true },
      version: 1,
    });
    writeCacheEntry(cacheDir, stalePinnedKey, {
      expires_at: expired,
      fetched_at: '2020-01-01T00:00:00.000Z',
      data: { ok: true },
      version: 1,
    });
    writeCacheEntry(cacheDir, mismatchKey, {
      expires_at: fresh,
      fetched_at: '2026-05-18T00:00:00.000Z',
      data: { ok: true },
      version: 999,
    });
    fs.writeFileSync(path.join(cacheDir, 'v1_rmp_search_bad.json'), '{bad');
    fs.writeFileSync(path.join(cacheDir, 'notes.txt'), 'not-cache');
    fs.writeFileSync(pinsFilePath, JSON.stringify({ version: 1, pins: {} }));

    const health = collectCacheHealth({
      cacheDir,
      pinsFilePath,
      pins: [
        {
          pinId: 'pin-1',
          resource_type: 'file',
          resource_key: 'redacted-resource',
          cacheKey: stalePinnedKey,
          pinned_at: now.toISOString(),
        },
        {
          pinId: 'pin-2',
          resource_type: 'sectiontext',
          resource_key: 'redacted-resource-2',
          cacheKey: missingPinnedKey,
          pinned_at: now.toISOString(),
        },
      ],
      pinQuotaLimitBytes: 1,
      now,
    });

    expect(health.cache.totals).toMatchObject({
      total_files: 6,
      json_files: 5,
      non_json_files: 1,
      valid_entries: 1,
      invalid_json_files: 1,
      schema_mismatches: 1,
      expired_unpinned_entries: 1,
      stale_pinned_entries: 1,
      pinned_cache_files: 1,
    });
    expect(health.pins).toMatchObject({
      pins_file_status: 'ok',
      pin_count: 2,
      missing_cache_files: 1,
    });
    expect(health.pins.quota.exceeded).toBe(true);
    expect(health.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'INVALID_CACHE_JSON',
        'SCHEMA_MISMATCH',
        'EXPIRED_UNPINNED',
        'STALE_PINNED',
        'PIN_CACHE_MISSING',
        'PIN_QUOTA_EXCEEDED',
      ])
    );
    expect(fs.existsSync(expiredFile)).toBe(true);

    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain(cacheDir);
    expect(serialized).not.toContain('pluginfile.php');
    expect(serialized).not.toContain('token=abc');
    expect(serialized).not.toContain(cacheFileName(stalePinnedKey));
  });
});

describe('cacheHealth tool', () => {
  it('returns validated text JSON without credentials or network calls', async () => {
    const result = await cacheHealth();
    const payload = JSON.parse(result.content[0].text);

    expect(payload.ok).toBe(true);
    expect(payload.cache.location).toBe('.eclass-mcp/cache');
    expect(payload.metrics).toMatchObject(snapshotCacheMetrics());
  });

  it('returns a redacted structured failure when health collection throws', async () => {
    const result = await cacheHealth(() => {
      throw new Error('Failed to read C:\\Users\\student\\.eclass-mcp\\cache');
    });
    const payload = JSON.parse(result.content[0].text);

    expect('isError' in result && result.isError).toBe(true);
    expect(payload).toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Cache health is temporarily unavailable.',
      isError: true,
    });
    expect(JSON.stringify(payload)).not.toContain('C:\\Users');
    expect(JSON.stringify(payload)).not.toContain('.eclass-mcp\\cache');
  });
});
