import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext } from 'playwright';
import { mintMobileTokenAfterLogin } from '../src/auth/mobile-mint';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import { rootLogger } from '../src/logging/logger';
import { canServeEclassReadsWithToken } from '../src/tools/auth-retry';
import * as session from '../src/scraper/session';

const ORIGIN = 'https://eclass.yorku.ca';
const FAKE_TOKEN = 'faketoken0123456789abcdef012345';
const FAKE_PRIVATE = 'fakeprivate0123456789abcdef0123';

function captureLogs() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(JSON.stringify(args));
  };
  vi.spyOn(rootLogger, 'info').mockImplementation(record as never);
  vi.spyOn(rootLogger, 'warn').mockImplementation(record as never);
  return lines;
}

function fakeContext(): BrowserContext {
  return { close: vi.fn(async () => undefined) } as unknown as BrowserContext;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mobile token mint after login', () => {
  it('reports a minted token and private-token presence without values', async () => {
    const logs = captureLogs();
    const launch = vi.fn(async () => ({
      service: 'moodle_mobile_app' as const,
      token: FAKE_TOKEN,
      privateToken: FAKE_PRIVATE,
      issuedAt: new Date().toISOString(),
    }));

    const outcome = await mintMobileTokenAfterLogin({
      context: fakeContext(),
      origin: ORIGIN,
      timeoutMs: 1000,
      sourceMode: 'shadow',
      createLauncher: () => ({ launch }),
    });

    expect(outcome).toEqual({ minted: true, privateToken: true });
    expect(launch).toHaveBeenCalledTimes(1);
    const text = logs.join('\n');
    expect(text).toContain('mobile_token_minted');
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain(FAKE_PRIVATE);
  });

  it('never fails the login when the mint fails', async () => {
    const logs = captureLogs();

    const outcome = await mintMobileTokenAfterLogin({
      context: fakeContext(),
      origin: ORIGIN,
      timeoutMs: 1000,
      sourceMode: 'shadow',
      createLauncher: () => ({
        launch: async () => {
          throw new MoodleApiError({
            category: 'capability_unavailable',
            upstreamCode: 'nopermissions',
          });
        },
      }),
    });

    expect(outcome.minted).toBe(false);
    expect(outcome.privateToken).toBe(false);
    expect(outcome.errorCode).toBeTruthy();
    expect(logs.join('\n')).toContain('mobile_token_mint_failed');
  });
});

describe('mobile token mint kill switch', () => {
  it('mints nothing in playwright mode', async () => {
    const launch = vi.fn();

    const outcome = await mintMobileTokenAfterLogin({
      context: fakeContext(),
      origin: ORIGIN,
      timeoutMs: 1000,
      sourceMode: 'playwright',
      createLauncher: () => ({ launch }),
    });

    expect(outcome).toEqual({
      minted: false,
      privateToken: false,
      errorCode: 'disabled',
    });
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('token-aware session check', () => {
  it('serves REST reads without cookies only in api mode with a token', () => {
    const has = vi.spyOn(session, 'hasMobileCredential');

    has.mockReturnValue(true);
    expect(canServeEclassReadsWithToken('api')).toBe(true);
    expect(canServeEclassReadsWithToken('shadow')).toBe(false);
    expect(canServeEclassReadsWithToken('playwright')).toBe(false);

    has.mockReturnValue(false);
    expect(canServeEclassReadsWithToken('api')).toBe(false);

    has.mockImplementation(() => {
      throw new Error('secure storage unavailable');
    });
    expect(canServeEclassReadsWithToken('api')).toBe(false);
  });
});
