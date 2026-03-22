import { describe, it, expect } from 'vitest';
import { TTL } from '../src/cache/store';

describe('cache TTL constants', () => {
  it('uses minute-based positive TTLs', () => {
    expect(TTL.COURSES).toBe(60 * 24);
    expect(TTL.CONTENT).toBe(60 * 6);
    expect(TTL.DEADLINES).toBe(60 * 2);
    expect(TTL.FILES).toBe(60 * 24 * 7);
  });
});
