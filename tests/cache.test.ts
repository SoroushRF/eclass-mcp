import { describe, it, expect } from 'vitest';
import {
  TTL,
  sanitizeCacheKeyForFilename,
  isCacheEntryExpired,
} from '../src/cache/store';

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

  it('detects expired cache entries', () => {
    const past = '2020-01-01T00:00:00.000Z';
    const future = '2035-01-01T00:00:00.000Z';
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(isCacheEntryExpired(past, now)).toBe(true);
    expect(isCacheEntryExpired(future, now)).toBe(false);
  });
});
