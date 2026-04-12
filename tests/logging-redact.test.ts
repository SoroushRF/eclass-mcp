import { describe, it, expect } from 'vitest';
import { redactCookieSubstrings, safeString } from '../src/logging/redact';
import { getLogger, runWithToolContext } from '../src/logging/context';

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

  it('safeString is an alias', () => {
    expect(safeString('sesskey=abc')).toBe(
      redactCookieSubstrings('sesskey=abc')
    );
  });
});

describe('runWithToolContext', () => {
  it('exposes child logger with tool binding inside fn', async () => {
    await runWithToolContext('test_tool', async () => {
      const log = getLogger();
      expect(log.bindings().tool).toBe('test_tool');
      expect(typeof log.bindings().requestId).toBe('string');
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
