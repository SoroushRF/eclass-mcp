import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import { MoodleRestClient } from '../src/scraper/eclass/api/rest';
import {
  FetchMoodleRestTransport,
  type FetchLike,
} from '../src/scraper/eclass/api/transport';
import { rootLogger } from '../src/logging/logger';

const ORIGIN = 'https://eclass.yorku.ca';
const TOKEN = 'fedcba9876543210fedcba9876543210';

function jsonResponse(
  payload: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function transport(fetchImpl: FetchLike, maxResponseBytes?: number) {
  return new FetchMoodleRestTransport({
    origin: ORIGIN,
    timeoutMs: 2500,
    maxResponseBytes,
    fetchImpl,
  });
}

function captureLogs() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(JSON.stringify(args));
  };
  vi.spyOn(rootLogger, 'info').mockImplementation(record as never);
  vi.spyOn(rootLogger, 'warn').mockImplementation(record as never);
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Fetch Moodle REST transport', () => {
  it('posts form-encoded REST calls with the token only in the body', async () => {
    const logs = captureLogs();
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ ok: true }));

    await expect(
      transport(fetchImpl).postRest(
        'core_course_get_contents',
        { courseid: 101, options: [{ name: 'excludemodules', value: true }] },
        TOKEN
      )
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/webservice/rest/server.php`);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.get('wstoken')).toBe(TOKEN);
    expect(body.get('wsfunction')).toBe('core_course_get_contents');
    expect(body.get('moodlewsrestformat')).toBe('json');
    expect(body.get('courseid')).toBe('101');
    expect(body.get('options[0][name]')).toBe('excludemodules');
    expect(body.get('options[0][value]')).toBe('1');
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('rejects unsafe origins, empty tokens, and invalid function names', async () => {
    expect(
      () =>
        new FetchMoodleRestTransport({
          origin: 'http://eclass.yorku.ca',
          timeoutMs: 1000,
        })
    ).toThrow(MoodleApiError);

    const fetchImpl = vi.fn<FetchLike>();
    await expect(
      transport(fetchImpl).postRest('core_webservice_get_site_info', {}, ' ')
    ).rejects.toMatchObject({ category: 'mobile_token_invalid' });
    await expect(
      transport(fetchImpl).postRest('../evil', {}, TOKEN)
    ).rejects.toMatchObject({ category: 'malformed_response' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enforces the response size cap from headers and while streaming', async () => {
    const declared = vi.fn<FetchLike>(async () =>
      jsonResponse({ ok: true }, { headers: { 'Content-Length': '999999' } })
    );
    await expect(
      transport(declared, 100).postRest('core_x', {}, TOKEN)
    ).rejects.toMatchObject({ category: 'malformed_response' });

    const streamed = vi.fn<FetchLike>(
      async () => new Response('x'.repeat(500), { status: 200 })
    );
    await expect(
      transport(streamed, 100).postRest('core_x', {}, TOKEN)
    ).rejects.toMatchObject({ category: 'malformed_response' });
  });

  it('classifies timeouts, rate limits, HTTP errors, and invalid JSON', async () => {
    captureLogs();
    const timeoutError = new Error('aborted');
    timeoutError.name = 'TimeoutError';
    await expect(
      transport(async () => {
        throw timeoutError;
      }).postRest('core_x', {}, TOKEN)
    ).rejects.toMatchObject({ category: 'timeout' });

    await expect(
      transport(async () => jsonResponse({}, { status: 429 })).postRest(
        'core_x',
        {},
        TOKEN
      )
    ).rejects.toMatchObject({ category: 'rate_limited', status: 429 });

    await expect(
      transport(async () => jsonResponse({}, { status: 403 })).postRest(
        'core_x',
        {},
        TOKEN
      )
    ).rejects.toMatchObject({ category: 'upstream', status: 403 });

    await expect(
      transport(async () => new Response('<html>', { status: 200 })).postRest(
        'core_x',
        {},
        TOKEN
      )
    ).rejects.toMatchObject({ category: 'malformed_response' });

    await expect(
      transport(async () => {
        throw new TypeError(`fetch failed for wstoken=${TOKEN}`);
      }).postRest('core_x', {}, TOKEN)
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof MoodleApiError &&
        error.category === 'upstream' &&
        !JSON.stringify(error).includes(TOKEN) &&
        !String(error).includes(TOKEN)
    );
  });

  it('re-mints once on invalidtoken through the REST client, then gives up', async () => {
    const logs = captureLogs();
    const tokens = [TOKEN, 'a'.repeat(32)];
    let current: string | null = tokens[0];
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      const body = new URLSearchParams(String(init.body));
      if (body.get('wstoken') === TOKEN) {
        return jsonResponse({
          exception: 'moodle_exception',
          errorcode: 'invalidtoken',
          message: 'Invalid token - token not found',
        });
      }
      return jsonResponse({ functions: [{ name: 'core_x' }] });
    });
    const reMint = vi.fn(async () => {
      current = tokens[1];
      return {
        service: 'moodle_mobile_app' as const,
        token: tokens[1],
        issuedAt: new Date().toISOString(),
      };
    });
    const client = new MoodleRestClient({
      transport: transport(fetchImpl),
      credentialReader: {
        load: () =>
          current
            ? {
                service: 'moodle_mobile_app',
                token: current,
                issuedAt: new Date().toISOString(),
              }
            : null,
        clear: () => {
          current = null;
        },
      },
      reMint,
    });

    await expect(client.discoverCapabilities()).resolves.toEqual(
      new Set(['core_x'])
    );
    expect(reMint).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logs.join('\n')).not.toContain(TOKEN);

    // A second invalidtoken after the one re-mint surfaces as SESSION_EXPIRED.
    current = TOKEN;
    reMint.mockImplementationOnce(async () => {
      current = TOKEN;
      return {
        service: 'moodle_mobile_app' as const,
        token: TOKEN,
        issuedAt: new Date().toISOString(),
      };
    });
    await expect(client.discoverCapabilities(true)).rejects.toMatchObject({
      category: 'mobile_token_invalid',
      publicCode: 'SESSION_EXPIRED',
    });
  });

  it('maps invalidparameter and accessexception envelopes', async () => {
    captureLogs();
    const client = (errorcode: string) =>
      new MoodleRestClient({
        transport: transport(async (_url, init) => {
          const fn = new URLSearchParams(String(init.body)).get('wsfunction');
          return fn === 'core_webservice_get_site_info'
            ? jsonResponse({ functions: [{ name: 'core_x' }] })
            : jsonResponse({ exception: 'x', errorcode, message: 'm' });
        }),
        credentialReader: {
          load: () => ({
            service: 'moodle_mobile_app',
            token: TOKEN,
            issuedAt: new Date().toISOString(),
          }),
          clear: () => undefined,
        },
      });

    await expect(
      client('invalidparameter').callCapability('core_x')
    ).rejects.toMatchObject({
      category: 'invalid_parameter',
      publicCode: 'VALIDATION_FAILED',
    });
    await expect(
      client('accessexception').callCapability('core_x')
    ).rejects.toMatchObject({ category: 'capability_unavailable' });
  });
});
