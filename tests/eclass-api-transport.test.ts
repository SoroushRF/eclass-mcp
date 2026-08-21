import type { APIRequestContext } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import {
  PlaywrightMoodleTransport,
  DEFAULT_MOODLE_RESPONSE_BYTES,
} from '../src/scraper/eclass/api/transport';

function response(status: number, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    status: vi.fn(() => status),
    body: vi.fn(async () => body),
  };
}

function createTransport(
  post: ReturnType<typeof vi.fn>,
  options: Partial<{
    timeoutMs: number;
    maxResponseBytes: number;
  }> = {}
) {
  return new PlaywrightMoodleTransport({
    request: { post } as unknown as APIRequestContext,
    origin: 'https://eclass.yorku.ca',
    timeoutMs: options.timeoutMs ?? 2500,
    maxResponseBytes: options.maxResponseBytes,
  });
}

describe('Playwright Moodle transport', () => {
  it('posts AJAX calls through the authenticated request context', async () => {
    const request = vi.fn(async () =>
      response(200, [{ error: false, data: { ok: true } }])
    );
    const transport = createTransport(request);
    const calls = [
      {
        index: 0,
        methodname: 'core_course_get_state',
        args: { courseid: 101 },
      },
    ];

    await expect(transport.postAjax(calls, 'sesskey-secret')).resolves.toEqual([
      { error: false, data: { ok: true } },
    ]);

    const [url, options] = request.mock.calls[0] as unknown as [
      string,
      { data: string; headers: Record<string, string>; timeout: number },
    ];
    expect(new URL(url).pathname).toBe('/lib/ajax/service.php');
    expect(new URL(url).searchParams.get('sesskey')).toBe('sesskey-secret');
    expect(JSON.parse(options.data)).toEqual(calls);
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.timeout).toBe(2500);
  });

  it('sends REST credentials only in the form body', async () => {
    const request = vi.fn(async () =>
      response(200, { sitename: 'eClass', functions: [] })
    );
    const transport = createTransport(request);

    await transport.postRest(
      'core_webservice_get_site_info',
      { courseids: [101, 202], options: { include: true } },
      'mobile-token-secret'
    );

    const [url, options] = request.mock.calls[0] as unknown as [
      string,
      { data: string },
    ];
    expect(new URL(url).pathname).toBe('/webservice/rest/server.php');
    expect(url).not.toContain('mobile-token-secret');
    const form = new URLSearchParams(options.data);
    expect(form.get('wstoken')).toBe('mobile-token-secret');
    expect(form.get('wsfunction')).toBe('core_webservice_get_site_info');
    expect(form.get('courseids[0]')).toBe('101');
    expect(form.get('courseids[1]')).toBe('202');
    expect(form.get('options[include]')).toBe('1');
  });

  it('rejects empty credentials before making a request', async () => {
    const request = vi.fn();
    const transport = createTransport(request);

    await expect(transport.postAjax([], ' ')).rejects.toMatchObject({
      category: 'session_invalid',
      publicCode: 'SESSION_EXPIRED',
    });
    await expect(
      transport.postRest('core_webservice_get_site_info', {}, '')
    ).rejects.toMatchObject({
      category: 'mobile_token_invalid',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('classifies status, timeout, malformed, and oversized responses safely', async () => {
    const rateLimited = createTransport(
      vi.fn(async () => response(429, { token: 'not logged' }))
    );
    await expect(rateLimited.postAjax([], 'sesskey')).rejects.toMatchObject({
      category: 'rate_limited',
      publicCode: 'RATE_LIMITED',
    });

    const timeout = createTransport(
      vi.fn(async () => {
        const error = new Error('request timeout');
        error.name = 'TimeoutError';
        throw error;
      })
    );
    await expect(timeout.postAjax([], 'sesskey')).rejects.toMatchObject({
      category: 'timeout',
      publicCode: 'TIMEOUT',
    });

    const malformed = createTransport(
      vi.fn(async () => ({
        status: vi.fn(() => 200),
        body: vi.fn(async () => Buffer.from('{broken')),
      }))
    );
    await expect(malformed.postAjax([], 'sesskey')).rejects.toMatchObject({
      category: 'malformed_response',
    });

    const oversized = createTransport(
      vi.fn(async () => response(200, { ok: true })),
      { maxResponseBytes: 1 }
    );
    await expect(oversized.postAjax([], 'sesskey')).rejects.toMatchObject({
      category: 'malformed_response',
    });
    expect(DEFAULT_MOODLE_RESPONSE_BYTES).toBeGreaterThan(1024);
  });

  it('rejects non-HTTPS origins and invalid function names', async () => {
    expect(
      () =>
        new PlaywrightMoodleTransport({
          request: {} as APIRequestContext,
          origin: 'http://eclass.yorku.ca',
          timeoutMs: 1000,
        })
    ).toThrow(MoodleApiError);

    const transport = createTransport(vi.fn());
    await expect(
      transport.postRest('core.webservice', {}, 'token')
    ).rejects.toMatchObject({
      category: 'malformed_response',
    });
  });
});
