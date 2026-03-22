import { describe, it, expect } from 'vitest';
import {
  TTL,
  sanitizeCacheKeyForFilename,
  isCacheEntryExpired,
} from '../src/cache/store';

describe('cache TTL constants', () => {
  it('uses minute-based positive TTLs', () => {
    expect(TTL.COURSES).toBe(60 * 24);
    expect(TTL.CONTENT).toBe(60 * 6);
    expect(TTL.DEADLINES).toBe(60 * 2);
    expect(TTL.FILES).toBe(60 * 24 * 7);
  });
});

describe('cache key + expiry helpers', () => {
  it('sanitizes keys for filenames', () => {
    expect(sanitizeCacheKeyForFilename('deadlines:foo/bar')).toBe(
      'deadlines_foo_bar'
    );
    expect(sanitizeCacheKeyForFilename('plain_key')).toBe('plain_key');
  });

  it('detects expired cache entries', () => {
    const past = '2020-01-01T00:00:00.000Z';
    const future = '2035-01-01T00:00:00.000Z';
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(isCacheEntryExpired(past, now)).toBe(true);
    expect(isCacheEntryExpired(future, now)).toBe(false);
  });
});
