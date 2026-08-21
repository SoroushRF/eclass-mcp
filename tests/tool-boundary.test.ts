import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { ValidationError } from '../src/errors/validation-error';
import {
  ScrapeLayoutError,
  SessionExpiredError,
  UpstreamError,
} from '../src/scraper/eclass';
import { SecureSessionStorageError } from '../src/security/secure-session-store';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import { EclassToolJsonPayloadSchema } from '../src/tools/eclass-contracts';
import {
  runEclassToolBoundary,
  runToolBoundary,
  sessionExpiredResponse,
} from '../src/tools/tool-boundary';

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

function parsePayload(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0].text ?? '{}');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runEclassToolBoundary', () => {
  it('maps secure session storage errors without opening auth', async () => {
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);

    const result = await runEclassToolBoundary({
      toolName: 'list_courses',
      run: async () => {
        throw new SecureSessionStorageError('missing_secret', 'missing secret');
      },
    });

    const payload = parsePayload(result);
    expect(payload.status).toBe('error');
    expect(payload.code).toBe('SESSION_STORAGE_UNAVAILABLE');
    expect(payload.retry.afterAuth).toBe(false);
    expect(openAuthSpy).not.toHaveBeenCalled();
  });

  it('opens eClass auth and retries once when auth completes', async () => {
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    const waitSpy = vi
      .spyOn(authServer, 'waitForAuthSession')
      .mockResolvedValue(true);
    const retry = vi.fn().mockResolvedValue(textResult({ ok: true }));
    const fallback = vi
      .fn()
      .mockReturnValue(textResult({ status: 'fallback' }));

    const result = await runEclassToolBoundary({
      toolName: 'list_courses',
      run: async () => {
        throw new SessionExpiredError('expired');
      },
      onSessionExpired: {
        retry,
        fallback,
      },
    });

    expect(parsePayload(result)).toEqual({ ok: true });
    expect(openAuthSpy).toHaveBeenCalledWith('eclass');
    expect(waitSpy).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('returns auth fallback when auth wait times out', async () => {
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(false);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );
    const retry = vi.fn().mockResolvedValue(textResult({ ok: true }));
    const fallback = vi.fn((error: SessionExpiredError) =>
      sessionExpiredResponse('list_courses', EclassToolJsonPayloadSchema, error)
    );

    const result = await runEclassToolBoundary({
      toolName: 'list_courses',
      run: async () => {
        throw new SessionExpiredError('expired');
      },
      onSessionExpired: {
        retry,
        fallback,
      },
    });

    const payload = parsePayload(result);
    expect(payload.status).toBe('auth_required');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry.authUrl).toBe('http://localhost:3000/auth');
    expect(retry).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('returns fallback when the retry still sees an expired session', async () => {
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(true);
    const retry = vi
      .fn()
      .mockRejectedValue(new SessionExpiredError('still expired'));
    const fallback = vi.fn((error: SessionExpiredError) =>
      sessionExpiredResponse('list_courses', EclassToolJsonPayloadSchema, error)
    );

    const result = await runEclassToolBoundary({
      toolName: 'list_courses',
      run: async () => {
        throw new SessionExpiredError('expired');
      },
      onSessionExpired: {
        retry,
        fallback,
      },
    });

    const payload = parsePayload(result);
    expect(payload.status).toBe('auth_required');
    expect(payload.message).toBe('still expired');
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('maps validation, scrape-layout, and upstream errors to machine-coded payloads', async () => {
    let result = await runEclassToolBoundary({
      toolName: 'get_section_text',
      run: async () => {
        throw new ValidationError('bad url', { field: 'url' });
      },
    });
    let payload = parsePayload(result);
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.details.field).toBe('url');

    result = await runEclassToolBoundary({
      toolName: 'get_section_text',
      run: async () => {
        throw new ScrapeLayoutError('layout moved', { selector: '.missing' });
      },
    });
    payload = parsePayload(result);
    expect(payload.code).toBe('SCRAPE_LAYOUT_CHANGED');
    expect(payload.details.selector).toBe('.missing');

    result = await runEclassToolBoundary({
      toolName: 'get_file_text',
      run: async () => {
        throw new UpstreamError('TIMEOUT', 'Moodle timed out', 504);
      },
    });
    payload = parsePayload(result);
    expect(payload.code).toBe('TIMEOUT');
    expect(payload.details.httpStatus).toBe(504);
  });

  it('maps Moodle capability, rate-limit, and session errors without upstream bodies', async () => {
    let result = await runEclassToolBoundary<ReturnType<typeof textResult>>({
      toolName: 'get_course_content',
      run: async () => {
        throw new MoodleApiError({
          category: 'capability_unavailable',
          upstreamCode: 'servicenotavailable',
        });
      },
    });
    let payload = parsePayload(result);
    expect(payload).toMatchObject({
      status: 'error',
      code: 'UPSTREAM_ERROR',
      details: { category: 'capability_unavailable' },
    });
    expect(payload.message).not.toContain('servicenotavailable');

    result = await runEclassToolBoundary({
      toolName: 'get_deadlines',
      run: async () => {
        throw new MoodleApiError({ category: 'rate_limited', status: 429 });
      },
    });
    payload = parsePayload(result);
    expect(payload).toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED',
      details: { httpStatus: 429, category: 'rate_limited' },
    });

    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(true);
    const retry = vi.fn(async () => textResult({ retried: true }));
    const fallback = vi.fn<
      (error: SessionExpiredError) => ReturnType<typeof textResult>
    >((error) => textResult({ fallback: error.message }));
    result = await runEclassToolBoundary({
      toolName: 'list_courses',
      run: async (): Promise<ReturnType<typeof textResult>> => {
        throw new MoodleApiError({ category: 'session_invalid' });
      },
      onSessionExpired: {
        retry,
        fallback,
      },
    });
    expect(parsePayload(result)).toEqual({ retried: true });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('maps unknown eClass errors to a redacted internal error by default', async () => {
    const unknown = new Error('unexpected');

    const result = await runEclassToolBoundary({
      toolName: 'list_courses',
      run: async () => {
        throw unknown;
      },
    });

    expect(parsePayload(result)).toMatchObject({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'The tool failed due to an unexpected internal error.',
    });
  });

  it('keeps generic boundary unknown errors strict unless a handler is provided', async () => {
    const unknown = new Error('unexpected');

    await expect(
      runToolBoundary({
        toolName: 'list_courses',
        run: async () => {
          throw unknown;
        },
      })
    ).rejects.toBe(unknown);

    const handled = await runEclassToolBoundary({
      toolName: 'get_exam_schedule',
      run: async () => {
        throw 'sis exploded';
      },
      onUnknownError: (error) =>
        textResult({ status: 'error', message: String(error) }),
    });

    expect(parsePayload(handled)).toEqual({
      status: 'error',
      message: 'sis exploded',
    });
  });
});
