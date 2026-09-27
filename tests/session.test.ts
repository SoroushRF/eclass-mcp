import fs from 'fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  AuthGenerationChangedError,
  clearSession,
  clearMobileCredential,
  getAuthGeneration,
  getSessionFilePath,
  hasMobileCredential,
  isSavedSessionFresh,
  isSessionValid,
  loadMobileCredential,
  loadSessionDataForTests,
  loadSession,
  saveMobileCredential,
  saveMobileCredentialForGeneration,
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
    'vitest-session-mobile.json',
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

  it('round-trips mobile credentials only through the encrypted session envelope', () => {
    const fileName = 'vitest-session-mobile.json';
    const token = 'mobile-token-never-plaintext';
    const credential = {
      service: 'moodle_mobile_app' as const,
      token,
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    saveSession([], fileName);
    saveMobileCredential(credential, fileName);

    expect(loadMobileCredential(fileName)).toEqual(credential);
    expect(hasMobileCredential(fileName)).toBe(true);
    expect(loadSessionDataForTests(fileName)).toMatchObject({
      schema_version: SESSION_DATA_SCHEMA_VERSION,
      mobile: credential,
    });
    expect(
      fs.readFileSync(getSessionFilePath(fileName), 'utf-8')
    ).not.toContain(token);

    clearMobileCredential(fileName);
    expect(loadMobileCredential(fileName)).toBeNull();
    expect(hasMobileCredential(fileName)).toBe(false);
  });

  it('refuses to save a renewed token after logout or a new login', () => {
    const fileName = 'vitest-session-mobile.json';
    const credential = {
      service: 'moodle_mobile_app' as const,
      token: 'fake-renewed-token',
      issuedAt: new Date().toISOString(),
    };

    saveSession([], fileName);
    const renewalStart = getAuthGeneration();
    // Logout while the renewal is in flight.
    clearSession(fileName);
    expect(() =>
      saveMobileCredentialForGeneration(credential, renewalStart, fileName)
    ).toThrow(AuthGenerationChangedError);
    expect(fs.existsSync(getSessionFilePath(fileName))).toBe(false);

    saveSession([], fileName);
    const afterLogin = getAuthGeneration();
    saveSession([], fileName);
    expect(() =>
      saveMobileCredentialForGeneration(credential, afterLogin, fileName)
    ).toThrow(AuthGenerationChangedError);
    expect(loadMobileCredential(fileName)).toBeNull();

    saveMobileCredentialForGeneration(
      credential,
      getAuthGeneration(),
      fileName
    );
    expect(loadMobileCredential(fileName)).toEqual(credential);
  });

  it('round-trips an optional private token and still loads credentials without one', () => {
    const fileName = 'vitest-session-mobile.json';
    const base = {
      service: 'moodle_mobile_app' as const,
      token: 'f'.repeat(32),
      issuedAt: new Date().toISOString(),
    };

    // Envelope written before privateToken existed: no schema bump needed.
    writeSecureJsonFile(getSessionFilePath(fileName), {
      schema_version: SESSION_DATA_SCHEMA_VERSION,
      saved_at: new Date().toISOString(),
      cookies: [],
      mobile: base,
    });
    expect(loadMobileCredential(fileName)).toEqual(base);

    const withPrivate = { ...base, privateToken: 'e'.repeat(64) };
    saveMobileCredential(withPrivate, fileName);
    expect(loadMobileCredential(fileName)).toEqual(withPrivate);
    expect(
      fs.readFileSync(getSessionFilePath(fileName), 'utf-8')
    ).not.toContain(withPrivate.privateToken);

    expect(() =>
      saveMobileCredential({ ...base, privateToken: '  ' }, fileName)
    ).toThrow();
    clearMobileCredential(fileName);
  });

  it('stores a token without a cookie session and never marks cookies fresh', () => {
    const fileName = 'vitest-session-mobile.json';
    cleanupSessionFile(fileName);
    const credential = {
      service: 'moodle_mobile_app' as const,
      token: 'a'.repeat(32),
      issuedAt: new Date().toISOString(),
    };

    saveMobileCredential(credential, fileName);

    expect(loadMobileCredential(fileName)).toEqual(credential);
    expect(isSessionValid(fileName)).toBe(false);
    expect(loadSession(fileName)).toBeNull();
    expect(loadSessionDataForTests(fileName)).toMatchObject({
      cookies: [],
      saved_at: new Date(0).toISOString(),
    });
  });

  it('loads schema-version-one cookie sessions without a mobile credential', () => {
    const fileName = 'vitest-session-mobile.json';
    writeSecureJsonFile(getSessionFilePath(fileName), {
      schema_version: 1,
      saved_at: new Date().toISOString(),
      cookies: [],
    });

    expect(loadSessionDataForTests(fileName)).toMatchObject({
      schema_version: SESSION_DATA_SCHEMA_VERSION,
      cookies: [],
    });
    expect(loadMobileCredential(fileName)).toBeNull();
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
