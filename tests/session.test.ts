import fs from 'fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  clearSession,
  getSessionFilePath,
  isSavedSessionFresh,
  isSessionValid,
  loadSession,
  saveSession,
  SESSION_STALE_HOURS,
} from '../src/scraper/session';

function cleanupSessionFile(fileName: string): void {
  try {
    clearSession(fileName);
  } catch {
    // Best-effort cleanup for local test artifacts.
  }
}

afterEach(() => {
  const files = [
    'vitest-session-fresh.json',
    'vitest-session-stale.json',
    'vitest-session-invalid.json',
    'vitest-session-delete.json',
    'vitest-session-save-error.json',
  ];
  for (const fileName of files) {
    cleanupSessionFile(fileName);
  }
  vi.restoreAllMocks();
});

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

describe('session file behavior', () => {
  it('returns null for missing session files', () => {
    expect(loadSession('vitest-session-fresh.json')).toBeNull();
    expect(isSessionValid('vitest-session-fresh.json')).toBe(false);
  });

  it('loads fresh sessions and validates them', () => {
    const cookies = [
      {
        name: 'MoodleSession',
        value: 'abc123',
        domain: 'eclass.yorku.ca',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      },
    ];

    saveSession(cookies, 'vitest-session-fresh.json');
    expect(loadSession('vitest-session-fresh.json')).toEqual(cookies);
    expect(isSessionValid('vitest-session-fresh.json')).toBe(true);
  });

  it('rejects stale sessions from disk', () => {
    const filePath = getSessionFilePath('vitest-session-stale.json');
    const stale = {
      saved_at: '2020-01-01T00:00:00.000Z',
      cookies: [],
    };
    fs.writeFileSync(filePath, JSON.stringify(stale), 'utf-8');

    expect(loadSession('vitest-session-stale.json')).toBeNull();
    expect(isSessionValid('vitest-session-stale.json')).toBe(false);
  });

  it('handles invalid JSON session files safely', () => {
    const filePath = getSessionFilePath('vitest-session-invalid.json');
    fs.writeFileSync(filePath, '{invalid-json', 'utf-8');

    expect(loadSession('vitest-session-invalid.json')).toBeNull();
    expect(isSessionValid('vitest-session-invalid.json')).toBe(false);
  });

  it('clearSession deletes existing files and is safe when absent', () => {
    const fileName = 'vitest-session-delete.json';
    const filePath = getSessionFilePath(fileName);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ saved_at: new Date().toISOString(), cookies: [] }),
      'utf-8'
    );

    expect(fs.existsSync(filePath)).toBe(true);
    clearSession(fileName);
    expect(fs.existsSync(filePath)).toBe(false);

    expect(() => clearSession(fileName)).not.toThrow();
  });

  it('swallows write failures in saveSession', () => {
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => undefined as never);
    writeSpy.mockImplementationOnce(() => {
      throw new Error('simulated write failure');
    });

    expect(() =>
      saveSession(
        [
          {
            name: 'MoodleSession',
            value: 'broken',
            domain: 'eclass.yorku.ca',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ],
        'vitest-session-save-error.json'
      )
    ).not.toThrow();
  });
});
