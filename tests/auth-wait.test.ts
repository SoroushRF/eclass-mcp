import fs from 'fs';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_WAIT_MS,
  resolveAuthWaitMs,
  waitForAuthSession,
} from '../src/auth/server';
import { getSessionFilePath } from '../src/scraper/session';

const sessionFilePath = getSessionFilePath();
let originalSessionFileContent: string | null = null;
const originalAuthWaitEnv = process.env.ECLASS_MCP_AUTH_WAIT_MS;

function removeSessionFile(): void {
  if (fs.existsSync(sessionFilePath)) {
    fs.unlinkSync(sessionFilePath);
  }
}

function writeFreshSession(): void {
  fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
  fs.writeFileSync(
    sessionFilePath,
    JSON.stringify({
      saved_at: new Date().toISOString(),
      cookies: [],
    }),
    'utf-8'
  );
}

beforeAll(() => {
  if (fs.existsSync(sessionFilePath)) {
    originalSessionFileContent = fs.readFileSync(sessionFilePath, 'utf-8');
  }
});

afterEach(() => {
  removeSessionFile();
  if (originalAuthWaitEnv === undefined) {
    delete process.env.ECLASS_MCP_AUTH_WAIT_MS;
  } else {
    process.env.ECLASS_MCP_AUTH_WAIT_MS = originalAuthWaitEnv;
  }
});

afterAll(() => {
  removeSessionFile();
  if (originalSessionFileContent !== null) {
    fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
    fs.writeFileSync(sessionFilePath, originalSessionFileContent, 'utf-8');
  }
});

describe('auth session wait helper', () => {
  it('uses default auth wait for missing or invalid env values', () => {
    expect(resolveAuthWaitMs(undefined)).toBe(DEFAULT_AUTH_WAIT_MS);
    expect(resolveAuthWaitMs('')).toBe(DEFAULT_AUTH_WAIT_MS);
    expect(resolveAuthWaitMs('not-a-number')).toBe(DEFAULT_AUTH_WAIT_MS);
    expect(resolveAuthWaitMs('-10')).toBe(DEFAULT_AUTH_WAIT_MS);
  });

  it('uses explicit env auth wait when valid', () => {
    expect(resolveAuthWaitMs('2500')).toBe(2500);
  });

  it('returns true when a fresh session is already present', async () => {
    writeFreshSession();

    await expect(
      waitForAuthSession({ timeoutMs: 5, pollIntervalMs: 1 })
    ).resolves.toBe(true);
  });

  it('returns false when the session does not become valid before timeout', async () => {
    removeSessionFile();

    await expect(
      waitForAuthSession({ timeoutMs: 5, pollIntervalMs: 1 })
    ).resolves.toBe(false);
  });
});
