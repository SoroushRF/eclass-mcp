import { describe, it, expect } from 'vitest';
import {
  buildFileCacheKey,
  buildContentCacheKey,
  canonicalResourceKey,
  computePinId,
} from '../src/cache/pins';
import { getCacheKey } from '../src/cache/store';

describe('pin cache keys', () => {
  it('buildFileCacheKey matches get_file_text key shape', () => {
    const url = 'https://eclass.yorku.ca/pluginfile.php/1/foo.pdf';
    expect(buildFileCacheKey(url)).toBe(getCacheKey('file', url));
    expect(buildFileCacheKey(url, 1, 5)).toBe(
      getCacheKey('file', url, 'p1-5')
    );
    expect(buildFileCacheKey(url, 1, undefined)).toBe(
      getCacheKey('file', url, 'p1-end')
    );
  });

  it('computePinId is stable for same resource', () => {
    const rk = canonicalResourceKey('content', { courseId: '12345' });
    expect(computePinId('content', rk)).toBe(computePinId('content', rk));
  });
});
