import fs from 'fs';
import path from 'path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  buildFileCacheKey,
  buildSectionTextCacheKey,
  checkPinQuota,
  canonicalResourceKey,
  computePinId,
  getAllPins,
  getCacheKeyFileSizeBytes,
  getPinnedBytes,
  getPinnedCacheFilenames,
  getPinById,
  getPinsFilePath,
  getQuotaLimitBytes,
  invalidatePinsMemoryCache,
  isCacheKeyPinned,
  loadPins,
  removePin,
  removePinsByFilter,
  upsertPin,
} from '../src/cache/pins';
import { getCacheFilePathForKey, getCacheKey } from '../src/cache/store';

const TEST_PIN_IDS = {
  alpha: 'vitest-pin-alpha',
  beta: 'vitest-pin-beta',
  gamma: 'vitest-pin-gamma',
};

const testCacheKeys = new Set<string>();
const originalQuotaEnv = process.env.ECLASS_MCP_PIN_QUOTA_BYTES;
const pinsFilePath = getPinsFilePath();
let originalPinsFileContent: string | null = null;

function writeCacheBlob(cacheKey: string, sizeBytes: number): void {
  const filePath = getCacheFilePathForKey(cacheKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, 120));
  testCacheKeys.add(cacheKey);
}

function cleanupTestArtifacts(): void {
  invalidatePinsMemoryCache();

  for (const cacheKey of testCacheKeys) {
    const filePath = getCacheFilePathForKey(cacheKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  testCacheKeys.clear();

  if (fs.existsSync(pinsFilePath)) {
    fs.unlinkSync(pinsFilePath);
  }

  const tmpPinsFilePath = `${pinsFilePath}.${process.pid}.tmp`;
  if (fs.existsSync(tmpPinsFilePath)) {
    fs.unlinkSync(tmpPinsFilePath);
  }
}

beforeAll(() => {
  if (fs.existsSync(pinsFilePath)) {
    originalPinsFileContent = fs.readFileSync(pinsFilePath, 'utf-8');
  }
});

beforeEach(() => {
  cleanupTestArtifacts();
  delete process.env.ECLASS_MCP_PIN_QUOTA_BYTES;
  vi.spyOn(fs, 'renameSync').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTestArtifacts();
  if (originalQuotaEnv === undefined) {
    delete process.env.ECLASS_MCP_PIN_QUOTA_BYTES;
  } else {
    process.env.ECLASS_MCP_PIN_QUOTA_BYTES = originalQuotaEnv;
  }
});

afterAll(() => {
  if (originalPinsFileContent === null) {
    if (fs.existsSync(pinsFilePath)) {
      fs.unlinkSync(pinsFilePath);
    }
    return;
  }

  fs.mkdirSync(path.dirname(pinsFilePath), { recursive: true });
  fs.writeFileSync(pinsFilePath, originalPinsFileContent, 'utf-8');
  invalidatePinsMemoryCache();
});

describe('pin cache keys', () => {
  it('buildFileCacheKey matches get_file_text key shape', () => {
    const url = 'https://eclass.yorku.ca/pluginfile.php/1/foo.pdf';
    expect(buildFileCacheKey(url)).toBe(getCacheKey('file', url));
    expect(buildFileCacheKey(url, 1, 5)).toBe(getCacheKey('file', url, 'p1-5'));
    expect(buildFileCacheKey(url, 1, undefined)).toBe(
      getCacheKey('file', url, 'p1-end')
    );
  });

  it('computePinId is stable for same resource', () => {
    const rk = canonicalResourceKey('content', { courseId: '12345' });
    expect(computePinId('content', rk)).toBe(computePinId('content', rk));
  });

  it('buildSectionTextCacheKey trims broken query spacing', () => {
    const url =
      ' https://eclass.yorku.ca/mod/page/view.php?id= 148310   &forcedownload=   ';
    expect(buildSectionTextCacheKey(url)).toBe(
      getCacheKey(
        'sectiontext',
        'https://eclass.yorku.ca/mod/page/view.php?id=148310'
      )
    );
  });

  it('canonicalResourceKey handles file ranges and section/content variants', () => {
    expect(
      canonicalResourceKey('file', {
        fileUrl: 'https://eclass.yorku.ca/pluginfile.php/1/doc.pdf',
        startPage: 2,
        endPage: 7,
      })
    ).toBe('https://eclass.yorku.ca/pluginfile.php/1/doc.pdf|p2-7');

    expect(
      canonicalResourceKey('sectiontext', {
        url: 'https://eclass.yorku.ca/mod/page/view.php?id= 111 ',
      })
    ).toBe('https://eclass.yorku.ca/mod/page/view.php?id=111');

    expect(canonicalResourceKey('content', { courseId: 'MATH1010' })).toBe(
      'MATH1010'
    );
  });
});

describe('pin storage and quota behavior', () => {
  it('uses default quota when env is missing or invalid', () => {
    delete process.env.ECLASS_MCP_PIN_QUOTA_BYTES;
    expect(getQuotaLimitBytes()).toBe(300 * 1024 * 1024);

    process.env.ECLASS_MCP_PIN_QUOTA_BYTES = 'not-a-number';
    expect(getQuotaLimitBytes()).toBe(300 * 1024 * 1024);

    process.env.ECLASS_MCP_PIN_QUOTA_BYTES = '-5';
    expect(getQuotaLimitBytes()).toBe(300 * 1024 * 1024);
  });

  it('uses explicit quota env when valid', () => {
    process.env.ECLASS_MCP_PIN_QUOTA_BYTES = '4096';
    expect(getQuotaLimitBytes()).toBe(4096);
  });

  it('loadPins tolerates missing, malformed, and invalid JSON files', () => {
    expect(loadPins().pins).toEqual({});

    fs.mkdirSync(path.dirname(pinsFilePath), { recursive: true });
    fs.writeFileSync(
      pinsFilePath,
      JSON.stringify({ version: 1, pins: null }),
      'utf-8'
    );
    invalidatePinsMemoryCache();
    expect(loadPins().pins).toEqual({});

    fs.writeFileSync(pinsFilePath, '{bad-json', 'utf-8');
    invalidatePinsMemoryCache();
    expect(loadPins().pins).toEqual({});
  });

  it('upserts, reads, and removes pin records', () => {
    const cacheKey = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/2/a.pdf'
    );

    upsertPin({
      pinId: TEST_PIN_IDS.alpha,
      resource_type: 'file',
      resource_key: 'https://eclass.yorku.ca/pluginfile.php/2/a.pdf',
      cacheKey,
      pinned_at: '2026-01-01T00:00:00.000Z',
      note: 'first',
    });

    expect(getPinById(TEST_PIN_IDS.alpha)?.note).toBe('first');
    expect(getAllPins()).toHaveLength(1);
    expect(removePin('does-not-exist')).toBe(false);
    expect(removePin(TEST_PIN_IDS.alpha)).toBe(true);
    expect(getAllPins()).toHaveLength(0);
  });

  it('removes by predicate and leaves non-matching pins', () => {
    const keyA = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/2/a.pdf'
    );
    const keyB = getCacheKey('content', 'MATH1010');
    const keyC = getCacheKey(
      'sectiontext',
      'https://eclass.yorku.ca/mod/page/view.php?id=7'
    );

    upsertPin({
      pinId: TEST_PIN_IDS.alpha,
      resource_type: 'file',
      resource_key: 'a',
      cacheKey: keyA,
      pinned_at: '2026-01-01T00:00:00.000Z',
    });
    upsertPin({
      pinId: TEST_PIN_IDS.beta,
      resource_type: 'content',
      resource_key: 'MATH1010',
      cacheKey: keyB,
      pinned_at: '2026-01-01T00:00:00.000Z',
    });
    upsertPin({
      pinId: TEST_PIN_IDS.gamma,
      resource_type: 'sectiontext',
      resource_key: 'https://eclass.yorku.ca/mod/page/view.php?id=7',
      cacheKey: keyC,
      pinned_at: '2026-01-01T00:00:00.000Z',
    });

    const removed = removePinsByFilter((p) => p.resource_type !== 'content');
    expect(removed).toHaveLength(2);
    expect(getAllPins()).toHaveLength(1);
    expect(getAllPins()[0]?.resource_type).toBe('content');
  });

  it('tracks pinned filenames and pinned cache keys', () => {
    const keyA = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/3/a.pdf'
    );
    upsertPin({
      pinId: TEST_PIN_IDS.alpha,
      resource_type: 'file',
      resource_key: 'x',
      cacheKey: keyA,
      pinned_at: '2026-01-01T00:00:00.000Z',
    });

    const filenames = getPinnedCacheFilenames();
    expect(filenames.size).toBe(1);
    expect(isCacheKeyPinned(keyA)).toBe(true);
    expect(isCacheKeyPinned(getCacheKey('file', 'missing'))).toBe(false);
  });

  it('computes pinned bytes once per cache key even with duplicate pins', () => {
    const keyA = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/4/a.pdf'
    );
    writeCacheBlob(keyA, 21);

    upsertPin({
      pinId: TEST_PIN_IDS.alpha,
      resource_type: 'file',
      resource_key: 'k1',
      cacheKey: keyA,
      pinned_at: '2026-01-01T00:00:00.000Z',
    });
    upsertPin({
      pinId: TEST_PIN_IDS.beta,
      resource_type: 'file',
      resource_key: 'k2',
      cacheKey: keyA,
      pinned_at: '2026-01-01T00:00:00.000Z',
    });

    expect(getPinnedBytes()).toBe(21);
  });

  it('returns per-cache-key file size and falls back to 0 when absent', () => {
    const existingKey = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/5/a.pdf'
    );
    const missingKey = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/5/missing.pdf'
    );

    writeCacheBlob(existingKey, 33);

    expect(getCacheKeyFileSizeBytes(existingKey)).toBe(33);
    expect(getCacheKeyFileSizeBytes(missingKey)).toBe(0);
  });

  it('checks pin quota for exceeded, already-counted, and replacement cases', () => {
    process.env.ECLASS_MCP_PIN_QUOTA_BYTES = '10';

    const existingKey = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/9/existing.pdf'
    );
    const alreadyCountedKey = existingKey;
    const candidateKey = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/9/new.pdf'
    );
    const tinyKey = getCacheKey(
      'file',
      'https://eclass.yorku.ca/pluginfile.php/9/tiny.pdf'
    );

    writeCacheBlob(existingKey, 8);
    writeCacheBlob(candidateKey, 5);
    writeCacheBlob(tinyKey, 1);

    upsertPin({
      pinId: TEST_PIN_IDS.alpha,
      resource_type: 'file',
      resource_key: 'existing',
      cacheKey: existingKey,
      pinned_at: '2026-01-01T00:00:00.000Z',
    });

    const exceeded = checkPinQuota(candidateKey);
    expect(exceeded.ok).toBe(false);
    if (!exceeded.ok) {
      expect(exceeded.reason).toBe('quota_exceeded');
      expect(exceeded.used_bytes).toBe(8);
      expect(exceeded.would_use_bytes).toBe(5);
    }

    const alreadyCounted = checkPinQuota(alreadyCountedKey);
    expect(alreadyCounted.ok).toBe(true);
    if (alreadyCounted.ok) {
      expect(alreadyCounted.would_use_bytes).toBe(0);
    }

    const replacement = checkPinQuota(existingKey, TEST_PIN_IDS.alpha);
    expect(replacement.ok).toBe(true);
    if (replacement.ok) {
      expect(replacement.would_use_bytes).toBe(0);
    }

    const tiny = checkPinQuota(tinyKey);
    expect(tiny.ok).toBe(true);
    if (tiny.ok) {
      expect(tiny.would_use_bytes).toBe(1);
    }
  });
});
