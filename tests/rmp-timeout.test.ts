import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RMP_TIMEOUT_MS,
  RMPClient,
  resolveRmpTimeoutMs,
} from '../src/scraper/rmp';

const originalTimeout = process.env.ECLASS_MCP_RMP_TIMEOUT_MS;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalTimeout === undefined) {
    delete process.env.ECLASS_MCP_RMP_TIMEOUT_MS;
  } else {
    process.env.ECLASS_MCP_RMP_TIMEOUT_MS = originalTimeout;
  }
});

describe('RMP request timeouts', () => {
  it('uses the default timeout unless a positive override is configured', () => {
    expect(resolveRmpTimeoutMs(undefined)).toBe(DEFAULT_RMP_TIMEOUT_MS);
    expect(resolveRmpTimeoutMs('0')).toBe(DEFAULT_RMP_TIMEOUT_MS);
    expect(resolveRmpTimeoutMs('abc')).toBe(DEFAULT_RMP_TIMEOUT_MS);
    expect(resolveRmpTimeoutMs('2500')).toBe(2500);
  });

  it('aborts a hung GraphQL request and maps it to TIMEOUT', async () => {
    vi.useFakeTimers();
    process.env.ECLASS_MCP_RMP_TIMEOUT_MS = '25';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const assertion = expect(
      new RMPClient().searchTeachers('Jane Doe')
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
