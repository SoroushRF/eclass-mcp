import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getCengageSessionValidity,
  isSavedCengageSessionFresh,
  loadCengageSessionState,
  saveCengageSessionState,
  saveCengageSessionMetadata,
} from '../src/scraper/cengage-session';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eclass-mcp-cengage-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('cengage session staleness', () => {
  it('treats recent session as fresh', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const saved = '2026-01-15T11:30:00.000Z';
    expect(isSavedCengageSessionFresh(saved, now, 60)).toBe(true);
  });

  it('treats old session as stale', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    const saved = '2026-01-12T11:30:00.000Z';
    expect(isSavedCengageSessionFresh(saved, now, 60)).toBe(false);
  });
});

describe('cengage session validity', () => {
  it('returns missing_state when state file does not exist', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');

    const validity = getCengageSessionValidity({ statePath, metaPath });
    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe('missing_state');
  });

  it('accepts fresh metadata-based session', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');
    saveCengageSessionState(
      { cookies: [], origins: [] },
      {
        statePath,
        metaPath,
        savedAt: new Date('2026-01-15T11:00:00.000Z'),
      }
    );

    const validity = getCengageSessionValidity({
      statePath,
      metaPath,
      now: new Date('2026-01-15T12:00:00.000Z'),
      staleHours: 60,
    });

    expect(validity.valid).toBe(true);
    expect(validity.reason).toBe('ok');
  });

  it('returns stale when metadata timestamp is too old', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');
    saveCengageSessionState(
      { cookies: [], origins: [] },
      {
        statePath,
        metaPath,
        savedAt: new Date('2026-01-10T11:00:00.000Z'),
      }
    );

    const validity = getCengageSessionValidity({
      statePath,
      metaPath,
      now: new Date('2026-01-15T12:00:00.000Z'),
      staleHours: 60,
    });

    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe('stale');
  });

  it('returns invalid_meta when metadata file is malformed', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');
    saveCengageSessionState(
      { cookies: [], origins: [] },
      { statePath, metaPath }
    );
    fs.writeFileSync(metaPath, '{ malformed json', 'utf-8');

    const validity = getCengageSessionValidity({ statePath, metaPath });
    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe('invalid_meta');
  });

  it('backfills metadata from state file mtime when metadata is missing', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');
    saveCengageSessionState(
      { cookies: [], origins: [] },
      { statePath, metaPath, savedAt: new Date() }
    );
    fs.unlinkSync(metaPath);

    const validity = getCengageSessionValidity({
      statePath,
      metaPath,
      now: new Date(),
      staleHours: 60,
    });

    expect(validity.valid).toBe(true);
    expect(validity.reason).toBe('ok');
    expect(fs.existsSync(metaPath)).toBe(true);
  });

  it('rejects plaintext Cengage state as storage unavailable', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');
    fs.writeFileSync(statePath, JSON.stringify({ cookies: [] }), 'utf-8');
    saveCengageSessionMetadata({
      statePath,
      metaPath,
      savedAt: new Date('2026-01-15T11:00:00.000Z'),
    });

    const validity = getCengageSessionValidity({
      statePath,
      metaPath,
      now: new Date('2026-01-15T12:00:00.000Z'),
    });

    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe('storage_unavailable');
  });

  it('loads encrypted Cengage storage state without exposing raw cookies', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');
    saveCengageSessionState(
      {
        cookies: [
          {
            name: 'cengage-session',
            value: 'secret-cookie-value',
            domain: '.cengage.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
      { statePath, metaPath, savedAt: new Date('2026-01-15T11:00:00.000Z') }
    );

    expect(fs.readFileSync(statePath, 'utf-8')).not.toContain(
      'secret-cookie-value'
    );
    expect(
      loadCengageSessionState({ statePath }).storageState.cookies
    ).toHaveLength(1);
  });
});
