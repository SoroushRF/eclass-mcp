import { describe, it, expect } from 'vitest';
import {
  isSavedSessionFresh,
  SESSION_STALE_HOURS,
} from '../src/scraper/session';

describe('session staleness', () => {
  it('treats a recent save as fresh', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const saved = '2026-01-15T11:00:00.000Z'; // 1 hour ago
    expect(isSavedSessionFresh(saved, now, SESSION_STALE_HOURS)).toBe(true);
  });

  it('treats an old save as stale', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const saved = '2026-01-12T12:00:00.000Z'; // 72 hours ago
    expect(isSavedSessionFresh(saved, now, SESSION_STALE_HOURS)).toBe(false);
  });

  it('respects custom stale window', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const saved = '2026-01-15T11:30:00.000Z'; // 30 min ago
    expect(isSavedSessionFresh(saved, now, 1)).toBe(true);
    expect(isSavedSessionFresh(saved, now, 0.25)).toBe(false);
  });
});
