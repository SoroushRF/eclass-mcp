import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  ClearCacheToolResponseSchema,
  EclassAuthRequiredSchema,
  EclassCacheMetaSchema,
  EclassToolJsonPayloadSchema,
  GetFileTextMcpResultSchema,
  ItemDetailsMetaSchema,
  PinToolJsonPayloadSchema,
  RmpSearchToolResponseSchema,
  SisExamScheduleResponseSchema,
} from '../src/tools/eclass-contracts';
import {
  asValidatedMcpText,
  asValidatedMcpResult,
  isStrictToolOutput,
} from '../src/tools/mcp-validated-response';
import * as loggingContext from '../src/logging/context';

describe('isStrictToolOutput', () => {
  afterEach(() => {
    delete process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT;
  });

  it('is false when unset', () => {
    delete process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT;
    expect(isStrictToolOutput()).toBe(false);
  });

  it('is true for 1 and true', () => {
    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = '1';
    expect(isStrictToolOutput()).toBe(true);
    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = 'true';
    expect(isStrictToolOutput()).toBe(true);
    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = 'TRUE';
    expect(isStrictToolOutput()).toBe(true);
  });

  it('is false for other values', () => {
    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = '0';
    expect(isStrictToolOutput()).toBe(false);

    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = 'yes';
    expect(isStrictToolOutput()).toBe(false);
  });
});

describe('asValidatedMcpText', () => {
  const warnSpy = vi.fn();

  beforeEach(() => {
    warnSpy.mockClear();
    delete process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT;
    vi.spyOn(loggingContext, 'getLogger').mockReturnValue({
      warn: warnSpy,
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(),
    } as unknown as ReturnType<typeof loggingContext.getLogger>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const schema = z.object({ a: z.number() });

  it('returns validated JSON when parse succeeds', () => {
    const out = asValidatedMcpText('t', schema, { a: 1 });
    expect(out.content[0].text).toBe('{"a":1}');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns and returns original JSON when parse fails (non-strict)', () => {
    const out = asValidatedMcpText('t', schema, { b: 2 });
    expect(warnSpy).toHaveBeenCalled();
    expect(JSON.parse(out.content[0].text)).toEqual({ b: 2 });
  });

  it('uses strict parse when strict env is enabled', () => {
    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = 'true';
    const out = asValidatedMcpText('t', schema, { a: 3 });
    expect(out.content[0].text).toBe('{"a":3}');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('throws on invalid payload in strict mode', () => {
    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = '1';
    expect(() => asValidatedMcpText('t', schema, { nope: 1 })).toThrow();
  });
});

describe('asValidatedMcpResult', () => {
  const warnSpy = vi.fn();

  beforeEach(() => {
    warnSpy.mockClear();
    delete process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT;
    vi.spyOn(loggingContext, 'getLogger').mockReturnValue({
      warn: warnSpy,
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(),
    } as unknown as ReturnType<typeof loggingContext.getLogger>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const schema = GetFileTextMcpResultSchema;

  it('passes through valid multi-block content', () => {
    const r = asValidatedMcpResult('get_file_text', schema, {
      content: [{ type: 'text' as const, text: 'hi' }],
    });
    expect(r.content).toHaveLength(1);
  });

  it('warns and returns original result when non-strict validation fails', () => {
    const raw = { unexpected: true };
    const r = asValidatedMcpResult('get_file_text', schema, raw);

    expect(warnSpy).toHaveBeenCalled();
    expect(r).toBe(raw);
  });

  it('throws when strict validation fails', () => {
    process.env.ECLASS_MCP_STRICT_TOOL_OUTPUT = 'true';
    expect(() =>
      asValidatedMcpResult('get_file_text', schema, { nope: 1 })
    ).toThrow();
  });
});

describe('fixture JSON satisfies schemas (CI contract smoke)', () => {
  it('EclassToolJsonPayloadSchema accepts cache + auth shapes', () => {
    expect(
      EclassToolJsonPayloadSchema.safeParse({
        _cache: {
          hit: true,
          fetched_at: '2026-01-01T00:00:00.000Z',
          expires_at: '2026-01-01T01:00:00.000Z',
        },
        items: [],
      }).success
    ).toBe(true);

    expect(
      EclassToolJsonPayloadSchema.safeParse({
        status: 'auth_required',
        message: 'x',
        retry: { afterAuth: true, authUrl: 'http://localhost:3000/auth' },
      }).success
    ).toBe(true);
  });

  it('EclassCacheMetaSchema accepts stale', () => {
    expect(
      EclassCacheMetaSchema.safeParse({
        hit: false,
        fetched_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2026-01-01T01:00:00.000Z',
        stale: true,
      }).success
    ).toBe(true);
  });

  it('SisExamScheduleResponseSchema', () => {
    expect(
      SisExamScheduleResponseSchema.safeParse({
        status: 'ok',
        message: 'Found 1 upcoming exam(s).',
        exams: [{ course: 'TEST 1000' }],
      }).success
    ).toBe(true);
  });

  it('RmpSearchToolResponseSchema', () => {
    expect(
      RmpSearchToolResponseSchema.safeParse({
        summary: 'Found 1 RMP match(es):',
        matches: [{ teacherId: 'x' }],
        diagnostics: {},
      }).success
    ).toBe(true);
  });

  it('ClearCacheToolResponseSchema', () => {
    expect(
      ClearCacheToolResponseSchema.safeParse({
        ok: true,
        scope: 'all',
        clearedCount: 3,
        message: 'Successfully cleared...',
      }).success
    ).toBe(true);
  });

  it('PinToolJsonPayloadSchema', () => {
    expect(
      PinToolJsonPayloadSchema.safeParse({
        ok: true,
        pinId: 'p1',
      }).success
    ).toBe(true);
  });

  it('EclassAuthRequiredSchema', () => {
    expect(
      EclassAuthRequiredSchema.safeParse({
        status: 'auth_required',
        message: 'expired',
        retry: { afterAuth: true },
      }).success
    ).toBe(true);
  });

  it('ItemDetailsMetaSchema is permissive', () => {
    expect(
      ItemDetailsMetaSchema.safeParse({
        _cache: { hit: true, fetched_at: 'a', expires_at: 'b' },
        title: 'T',
        csvIncludedCount: 0,
      }).success
    ).toBe(true);
  });
});
