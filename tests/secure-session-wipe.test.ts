import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { secureDeleteFile } from '../src/security/secure-session-store';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eclass-mcp-wipe-'));
  tempDirs.push(dir);
  return dir;
}

async function loadWipeModule(root: string) {
  vi.resetModules();
  vi.doMock('../src/scraper/session', () => ({
    getSessionFilePath: () => path.join(root, 'session.json'),
  }));
  vi.doMock('../src/scraper/cengage-session', () => ({
    CENGAGE_STATE_PATH: path.join(root, 'cengage-state.json'),
    CENGAGE_SESSION_META_PATH: path.join(root, 'cengage-session-meta.json'),
  }));
  return await import('../src/security/auth-session-wipe');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('secure session wipe behavior', () => {
  it('secureDeleteFile removes an existing file and is safe for missing files', () => {
    const dir = makeTempDir();
    const target = path.join(dir, 'session.json');
    fs.writeFileSync(target, 'secret-session-bytes', 'utf8');

    expect(secureDeleteFile(target)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(secureDeleteFile(target)).toBe(false);
  });

  it('clearAllAuthSessions reports missing auth files without touching other local data', async () => {
    const root = makeTempDir();
    fs.writeFileSync(
      path.join(root, 'course-platform-index.json'),
      'index',
      'utf8'
    );
    fs.mkdirSync(path.join(root, 'cache'));
    fs.writeFileSync(path.join(root, 'cache', 'courses.json'), 'cache', 'utf8');

    const { clearAllAuthSessions } = await loadWipeModule(root);
    const result = clearAllAuthSessions();

    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        path.join(root, 'session.json'),
        path.join(root, 'cengage-state.json'),
        path.join(root, 'cengage-session-meta.json'),
      ])
    );
    expect(fs.existsSync(path.join(root, 'course-platform-index.json'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(root, 'cache', 'courses.json'))).toBe(true);
  });

  it('clearAllAuthSessions removes only auth files and interrupted auth temp files', async () => {
    const root = makeTempDir();
    const authFiles = [
      'session.json',
      'cengage-state.json',
      'cengage-session-meta.json',
      'session.json.tmp-abc',
      'cengage-state.json.tmp-def',
      'cengage-session-meta.json.tmp-ghi',
    ];
    for (const name of authFiles) {
      fs.writeFileSync(path.join(root, name), name, 'utf8');
    }
    fs.writeFileSync(
      path.join(root, 'course-platform-index.json'),
      'keep',
      'utf8'
    );
    fs.writeFileSync(
      path.join(root, 'session.json.not-a-temp'),
      'keep',
      'utf8'
    );

    const { clearAllAuthSessions } = await loadWipeModule(root);
    const result = clearAllAuthSessions();

    expect(result.errors).toEqual([]);
    expect(
      result.removed.map((filePath) => path.basename(filePath)).sort()
    ).toEqual(authFiles.sort());
    for (const name of authFiles) {
      expect(fs.existsSync(path.join(root, name))).toBe(false);
    }
    expect(fs.existsSync(path.join(root, 'course-platform-index.json'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(root, 'session.json.not-a-temp'))).toBe(
      true
    );
  });

  it('clearAllAuthSessions records delete errors and continues with later files', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'session.json'), 'session', 'utf8');
    fs.writeFileSync(path.join(root, 'cengage-state.json'), 'state', 'utf8');
    fs.writeFileSync(
      path.join(root, 'cengage-session-meta.json'),
      'meta',
      'utf8'
    );

    vi.resetModules();
    vi.doMock('../src/scraper/session', () => ({
      getSessionFilePath: () => path.join(root, 'session.json'),
    }));
    vi.doMock('../src/scraper/cengage-session', () => ({
      CENGAGE_STATE_PATH: path.join(root, 'cengage-state.json'),
      CENGAGE_SESSION_META_PATH: path.join(root, 'cengage-session-meta.json'),
    }));
    vi.doMock('../src/security/secure-session-store', () => ({
      secureDeleteFile: vi.fn((filePath: string) => {
        if (filePath.endsWith('cengage-state.json')) {
          throw new Error('locked by filesystem');
        }
        fs.unlinkSync(filePath);
        return true;
      }),
    }));

    const { clearAllAuthSessions } =
      await import('../src/security/auth-session-wipe');
    const result = clearAllAuthSessions();

    expect(result.removed).toEqual(
      expect.arrayContaining([
        path.join(root, 'session.json'),
        path.join(root, 'cengage-session-meta.json'),
      ])
    );
    expect(result.errors).toEqual([
      {
        path: path.join(root, 'cengage-state.json'),
        message: 'locked by filesystem',
      },
    ]);
    expect(fs.existsSync(path.join(root, 'cengage-state.json'))).toBe(true);
  });
});
