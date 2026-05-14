import fs from 'fs';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_WAIT_MS,
  resolveCengageAuthWaitMs,
  resolveAuthWaitMs,
  waitForAuthSession,
} from '../src/auth/server';
import { getSessionFilePath, saveSession } from '../src/scraper/session';

const sessionFilePath = getSessionFilePath();
let originalSessionFileContent: string | null = null;
const originalAuthWaitEnv = process.env.ECLASS_MCP_AUTH_WAIT_MS;
const originalCengageAuthWaitEnv = process.env.ECLASS_MCP_CENGAGE_AUTH_WAIT_MS;

function removeSessionFile(): void {
  if (fs.existsSync(sessionFilePath)) {
    fs.unlinkSync(sessionFilePath);
  }
}

function writeFreshSession(): void {
  saveSession([], path.basename(sessionFilePath));
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
  if (originalCengageAuthWaitEnv === undefined) {
    delete process.env.ECLASS_MCP_CENGAGE_AUTH_WAIT_MS;
  } else {
    process.env.ECLASS_MCP_CENGAGE_AUTH_WAIT_MS = originalCengageAuthWaitEnv;
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

  it('uses Cengage-specific auth wait when valid and falls back safely', () => {
    process.env.ECLASS_MCP_AUTH_WAIT_MS = '3000';
    expect(resolveCengageAuthWaitMs(undefined)).toBe(3000);
    expect(resolveCengageAuthWaitMs('4500')).toBe(4500);
    expect(resolveCengageAuthWaitMs('bad')).toBe(3000);
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
