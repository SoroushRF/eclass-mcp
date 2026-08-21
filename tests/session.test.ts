import fs from 'fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  clearSession,
  getSessionFilePath,
  isSavedSessionFresh,
  isSessionValid,
  loadSessionDataForTests,
  loadSession,
  saveSession,
  SESSION_DATA_SCHEMA_VERSION,
  SESSION_STALE_HOURS,
} from '../src/scraper/session';
import {
  SECURE_SESSION_FORMAT,
  SecureSessionStorageError,
  readSecureJsonFile,
  writeSecureJsonFile,
} from '../src/security/secure-session-store';

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
  it('requires a configured session secret', () => {
    const original = process.env.ECLASS_MCP_SESSION_SECRET;
    delete process.env.ECLASS_MCP_SESSION_SECRET;

    try {
      expect(() => saveSession([], 'vitest-session-fresh.json')).toThrow(
        /ECLASS_MCP_SESSION_SECRET/
      );
    } finally {
      process.env.ECLASS_MCP_SESSION_SECRET = original;
    }
  });

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
    expect(loadSessionDataForTests('vitest-session-fresh.json')).toMatchObject({
      schema_version: SESSION_DATA_SCHEMA_VERSION,
      cookies,
    });
    const raw = fs.readFileSync(
      getSessionFilePath('vitest-session-fresh.json'),
      'utf-8'
    );
    expect(raw).toContain(SECURE_SESSION_FORMAT);
    expect(raw).not.toContain('abc123');
  });

  it('rejects stale sessions from disk', () => {
    const filePath = getSessionFilePath('vitest-session-stale.json');
    const stale = {
      saved_at: '2020-01-01T00:00:00.000Z',
      cookies: [],
    };
    writeSecureJsonFile(filePath, stale);

    expect(loadSession('vitest-session-stale.json')).toBeNull();
    expect(isSessionValid('vitest-session-stale.json')).toBe(false);
  });

  it('rejects invalid JSON session files as unavailable secure storage', () => {
    const filePath = getSessionFilePath('vitest-session-invalid.json');
    fs.writeFileSync(filePath, '{invalid-json', 'utf-8');

    expect(() => loadSession('vitest-session-invalid.json')).toThrow(
      SecureSessionStorageError
    );
    expect(() => isSessionValid('vitest-session-invalid.json')).toThrow(
      SecureSessionStorageError
    );
  });

  it('rejects legacy plaintext sessions instead of migrating', () => {
    const filePath = getSessionFilePath('vitest-session-invalid.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ saved_at: new Date().toISOString(), cookies: [] }),
      'utf-8'
    );

    expect(() => loadSession('vitest-session-invalid.json')).toThrow(
      /Legacy plaintext/
    );
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

  it('throws storage-unavailable errors on secure write failures', () => {
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
    ).toThrow(SecureSessionStorageError);
  });

  it('decrypts secure JSON payloads with the configured secret', () => {
    const filePath = getSessionFilePath('vitest-session-fresh.json');
    writeSecureJsonFile(filePath, { marker: 'round-trip' });
    expect(readSecureJsonFile(filePath)).toEqual({ marker: 'round-trip' });
  });

  it('uses randomized envelopes for repeated writes of the same payload', () => {
    const filePathA = getSessionFilePath('vitest-session-fresh.json');
    const filePathB = getSessionFilePath('vitest-session-delete.json');
    writeSecureJsonFile(filePathA, { marker: 'same' });
    writeSecureJsonFile(filePathB, { marker: 'same' });

    expect(fs.readFileSync(filePathA, 'utf-8')).not.toEqual(
      fs.readFileSync(filePathB, 'utf-8')
    );
  });

  it('rejects secure files when the secret changes', () => {
    const original = process.env.ECLASS_MCP_SESSION_SECRET;
    const filePath = getSessionFilePath('vitest-session-fresh.json');
    writeSecureJsonFile(filePath, { marker: 'secret-bound' });

    process.env.ECLASS_MCP_SESSION_SECRET =
      'different-vitest-secure-session-secret-value';
    try {
      expect(() => readSecureJsonFile(filePath)).toThrow(
        SecureSessionStorageError
      );
    } finally {
      process.env.ECLASS_MCP_SESSION_SECRET = original;
    }
  });
});
