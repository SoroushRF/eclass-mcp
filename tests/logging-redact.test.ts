import { describe, it, expect } from 'vitest';
import {
  redactCookieSubstrings,
  redactUrlForLog,
  redactStructuredLogFields,
  safeString,
} from '../src/logging/redact';
import {
  createSafeApiLogFields,
  serializeApiErrorForLog,
} from '../src/logging/api-safe';
import {
  getLogger,
  getTraceContext,
  runWithSpan,
  runWithToolContext,
} from '../src/logging/context';
import { rootLogger } from '../src/logging/logger';

describe('redactCookieSubstrings', () => {
  it('redacts Set-Cookie and Cookie header lines', () => {
    const s =
      'req: Set-Cookie: session=abc123; Path=/\nother: Cookie: foo=bar; baz=qux';
    const r = redactCookieSubstrings(s);
    expect(r).not.toContain('abc123');
    expect(r).not.toContain('foo=bar');
    expect(r).toMatch(/Set-Cookie: \[Redacted\]/i);
    expect(r).toMatch(/Cookie: \[Redacted\]/i);
  });

  it('redacts sesskey and wstoken query params', () => {
    const s = 'https://x.com?id=1&sesskey=SECRET123&wstoken=TOKEN456&ok=1';
    const r = redactCookieSubstrings(s);
    expect(r).toContain('sesskey=[Redacted]');
    expect(r).toContain('wstoken=[Redacted]');
    expect(r).not.toContain('SECRET123');
    expect(r).not.toContain('TOKEN456');
  });

  it('redacts additional sensitive URL query params case-insensitively', () => {
    const s =
      'https://x.com?a=1&Token=t1&UserPass=p1&SAMLResponse=saml&RelayState=relay&ok=2';
    const r = redactCookieSubstrings(s);
    expect(r).toContain('Token=[Redacted]');
    expect(r).toContain('UserPass=[Redacted]');
    expect(r).toContain('SAMLResponse=[Redacted]');
    expect(r).toContain('RelayState=[Redacted]');
    expect(r).not.toContain('t1');
    expect(r).not.toContain('p1');
    expect(r).not.toContain('saml');
    expect(r).not.toContain('relay');
  });

  it('redacts URL credentials and sensitive query params for logs', () => {
    const r = redactUrlForLog(
      'https://user:pass@eclass.yorku.ca/mod/lti/view.php?code=abc&ok=1'
    );
    expect(r).not.toContain('user');
    expect(r).not.toContain('pass');
    expect(r).not.toContain('abc');
    expect(r).toContain('code=%5BRedacted%5D');
  });

  it('safeString is an alias', () => {
    expect(safeString('sesskey=abc')).toBe(
      redactCookieSubstrings('sesskey=abc')
    );
  });

  it('redacts authorization and launch redirect headers', () => {
    const value = redactCookieSubstrings(
      'Authorization: Bearer secret-token\nLocation: moodlemobile://launch?token=mobile-secret'
    );
    expect(value).not.toContain('secret-token');
    expect(value).not.toContain('mobile-secret');
    expect(value).toContain('Authorization: [Redacted]');
    expect(value).toContain('Location: [Redacted]');
  });

  it('redacts nested structured API fields and error bodies', () => {
    const value = redactStructuredLogFields({
      operation: 'ajax',
      headers: {
        authorization: 'Bearer secret',
        location: 'moodlemobile://?token=secret',
      },
      body: { sesskey: 'session-secret', safe: 'not-sensitive' },
      err: new Error('upstream body contains token=secret'),
    });

    expect(value).toMatchObject({
      operation: 'ajax',
      headers: {
        authorization: '[Redacted]',
        location: '[Redacted]',
      },
      body: '[Redacted]',
      err: { name: 'Error' },
    });
    expect(JSON.stringify(value)).not.toContain('secret');
    expect(JSON.stringify(value)).not.toContain('upstream body');
  });
});

describe('safe API telemetry', () => {
  it('keeps only path-level, bounded API diagnostics', () => {
    const fields = createSafeApiLogFields({
      operation: 'core_course_get_state',
      source: 'shadow',
      endpointPath:
        'https://eclass.yorku.ca/lib/ajax/service.php?sesskey=secret',
      status: 200,
      durationMs: 12.7,
      responseBytes: 99.4,
      errorCode: 'servicenotavailable',
      fallback: true,
      fallbackReason: 'malformed response',
    });

    expect(fields).toEqual({
      operation: 'core_course_get_state',
      source: 'shadow',
      endpointPath: '/lib/ajax/service.php',
      status: 200,
      durationMs: 13,
      responseBytes: 99,
      errorCode: 'servicenotavailable',
      fallback: true,
      fallbackReason: 'malformed_response',
    });
    expect(JSON.stringify(fields)).not.toContain('secret');
  });

  it('serializes API errors without upstream messages or bodies', () => {
    const serialized = serializeApiErrorForLog({
      name: 'MoodleApiError',
      category: 'capability_unavailable',
      message: '{"token":"secret"}',
    });
    expect(serialized).toEqual({
      errorType: 'MoodleApiError',
      errorCode: 'capability_unavailable',
    });
    expect(JSON.stringify(serialized)).not.toContain('secret');
  });
});

describe('runWithToolContext', () => {
  it('exposes child logger with tool binding inside fn', async () => {
    await runWithToolContext('test_tool', async () => {
      const log = getLogger();
      const trace = getTraceContext();
      expect(log.bindings().tool).toBe('test_tool');
      expect(typeof log.bindings().requestId).toBe('string');
      expect(typeof log.bindings().traceId).toBe('string');
      expect(typeof log.bindings().spanId).toBe('string');
      expect(log.bindings().span).toBe('mcp.tool');
      expect(log.bindings().component).toBe('mcp');
      expect(trace?.tool).toBe('test_tool');
      expect(trace?.requestId).toBe(log.bindings().requestId);
      expect(trace?.traceId).toBe(trace?.requestId);
      expect(trace?.spanId).toBe(log.bindings().spanId);
    });
  });

  it('rethrows errors after logging', async () => {
    await expect(
      runWithToolContext('failing_tool', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });
});

describe('trace spans', () => {
  it('returns root logger and no trace outside a context', () => {
    expect(getLogger()).toBe(rootLogger);
    expect(getTraceContext()).toBeNull();
  });

  it('preserves trace identity and restores parent context after nested spans', async () => {
    await runWithToolContext('trace_tool', async () => {
      const parentTrace = getTraceContext();
      expect(parentTrace).not.toBeNull();

      await runWithSpan(
        'child.operation',
        async () => {
          const childTrace = getTraceContext();
          const childBindings = getLogger().bindings();

          expect(childTrace?.requestId).toBe(parentTrace?.requestId);
          expect(childTrace?.traceId).toBe(parentTrace?.traceId);
          expect(childTrace?.spanId).not.toBe(parentTrace?.spanId);
          expect(childTrace?.parentSpanId).toBe(parentTrace?.spanId);
          expect(childTrace?.span).toBe('child.operation');
          expect(childTrace?.component).toBe('rmp');
          expect(childBindings.parentSpanId).toBe(parentTrace?.spanId);
        },
        { component: 'rmp', fields: { safeField: 'ok' } }
      );

      expect(getTraceContext()?.spanId).toBe(parentTrace?.spanId);
      expect(getTraceContext()?.span).toBe(parentTrace?.span);
    });
  });

  it('rethrows errors from nested spans', async () => {
    await expect(
      runWithToolContext('trace_error_tool', async () =>
        runWithSpan('child.failure', async () => {
          throw new Error('span boom');
        })
      )
    ).rejects.toThrow('span boom');
  });
});
