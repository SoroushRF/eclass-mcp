import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RMP_CIRCUIT_COOLDOWN_MS,
  RMP_CIRCUIT_FAILURE_THRESHOLD,
  RMPClient,
  resetRmpCircuitBreaker,
} from '../src/scraper/rmp';
import { searchProfessorsTool } from '../src/tools/rmp';
import { cache } from '../src/cache/store';

afterEach(() => {
  resetRmpCircuitBreaker();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function rateLimitedResponse(): Response {
  return new Response('too many requests', {
    status: 429,
    statusText: 'Too Many Requests',
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function parseToolJson(
  result: Awaited<ReturnType<typeof searchProfessorsTool>>
): Record<string, unknown> {
  const block = result.content[0];
  expect(block.type).toBe('text');
  return JSON.parse(block.text) as Record<string, unknown>;
}

describe('RMP circuit breaker', () => {
  it('opens after repeated RMP rate-limit responses and then fails fast', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(rateLimitedResponse()));
    const client = new RMPClient();

    for (let i = 0; i < RMP_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      await expect(
        client.getTeacherDetails(`teacher-${i}`)
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        httpStatus: 429,
      });
    }

    await expect(client.getTeacherDetails('blocked')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      httpStatus: undefined,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(RMP_CIRCUIT_FAILURE_THRESHOLD);
  });

  it('counts timeout-style fetch failures toward the breaker', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.reject(abortError()));
    const client = new RMPClient();

    for (let i = 0; i < RMP_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      await expect(
        client.getTeacherDetails(`teacher-${i}`)
      ).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
    }

    await expect(client.getTeacherDetails('blocked')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(RMP_CIRCUIT_FAILURE_THRESHOLD);
  });

  it('allows a half-open RMP probe after cooldown and closes on success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(rateLimitedResponse()));
    const client = new RMPClient();

    for (let i = 0; i < RMP_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      await expect(
        client.getTeacherDetails(`teacher-${i}`)
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    }

    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse({ data: { node: null } }))
    );
    vi.setSystemTime(Date.now() + RMP_CIRCUIT_COOLDOWN_MS + 1);

    await expect(client.getTeacherDetails('probe')).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(RMP_CIRCUIT_FAILURE_THRESHOLD + 1);
  });

  it('returns structured tool JSON when the RMP breaker is open', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(rateLimitedResponse()));
    const client = new RMPClient();

    for (let i = 0; i < RMP_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      await expect(
        client.getTeacherDetails(`teacher-${i}`)
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    }

    const result = await searchProfessorsTool({
      name: `Circuit Breaker Regression ${Date.now()}`,
    });
    const payload = parseToolJson(result);

    expect(payload).toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED',
    });
    expect(String(payload.message)).toContain('temporarily paused');
    expect(fetchSpy).toHaveBeenCalledTimes(RMP_CIRCUIT_FAILURE_THRESHOLD);
  });

  it('returns cached RMP search results without touching fetch', async () => {
    const cachedSearch = {
      matches: [
        {
          teacherId: 'cached-teacher',
          legacyId: 123,
          name: 'Cached Professor',
          department: 'Mathematics',
          school: 'York University',
        },
      ],
      diagnostics: {
        normalizedName: 'cached professor',
        campus: null,
        requestedSchoolIds: [],
        directMatchCount: 1,
        usedCrossCampusProbe: false,
        crossCampusMatchCount: 0,
        suspectedSchoolIdIssue: false,
        attempts: [],
      },
    };
    vi.spyOn(cache, 'getWithMeta').mockImplementation(<T>() => ({
      data: cachedSearch as T,
      version: 1,
      fetched_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-01-08T00:00:00.000Z',
    }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await searchProfessorsTool({ name: 'Cached Professor' });
    const payload = parseToolJson(result);

    expect(payload).toMatchObject({
      matches: cachedSearch.matches,
      _cache: { hit: true },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
