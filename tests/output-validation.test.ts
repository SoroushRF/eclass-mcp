import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applySoftOutputValidation,
  isSoftOutputValidationEnabled,
} from '../src/tools/output-validation';

describe('isSoftOutputValidationEnabled', () => {
  afterEach(() => {
    delete process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION;
  });

  it('is false when unset', () => {
    delete process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION;
    expect(isSoftOutputValidationEnabled()).toBe(false);
  });

  it('is true for 1 and true (case-insensitive)', () => {
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = '1';
    expect(isSoftOutputValidationEnabled()).toBe(true);
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = 'true';
    expect(isSoftOutputValidationEnabled()).toBe(true);
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = 'TRUE';
    expect(isSoftOutputValidationEnabled()).toBe(true);
  });
});

describe('applySoftOutputValidation', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    warnSpy.mockClear();
    delete process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION;
  });

  afterEach(() => {
    delete process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION;
  });

  it('returns the same result reference when flag is off', () => {
    const result = { content: [{ type: 'text' as const, text: '{}' }] };
    expect(applySoftOutputValidation('test', result)).toBe(result);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when flag is off even if JSON is a primitive', () => {
    const text = JSON.stringify('hello');
    const result = { content: [{ type: 'text' as const, text }] };
    applySoftOutputValidation('t', result);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('with flag on, valid object JSON does not warn', () => {
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = '1';
    const result = { content: [{ type: 'text' as const, text: '{"a":1}' }] };
    applySoftOutputValidation('t', result);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('with flag on, valid array JSON does not warn', () => {
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = '1';
    const result = { content: [{ type: 'text' as const, text: '[1,2,3]' }] };
    applySoftOutputValidation('t', result);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('with flag on, JSON primitive string warns once and leaves text unchanged', () => {
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = '1';
    const text = JSON.stringify('hello');
    const result = { content: [{ type: 'text' as const, text }] };
    const out = applySoftOutputValidation('tool_x', result);
    expect(out).toBe(result);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('tool_x');
  });

  it('with flag on, non-JSON text does not warn', () => {
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = '1';
    const result = {
      content: [{ type: 'text' as const, text: 'Session expired' }],
    };
    applySoftOutputValidation('t', result);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('with flag on, validates each text block independently', () => {
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = '1';
    const result = {
      content: [
        { type: 'text' as const, text: '{"ok":true}' },
        { type: 'text' as const, text: '--- CSV: x ---\na,b' },
        { type: 'text' as const, text: '42' },
      ],
    };
    applySoftOutputValidation('get_item_details', result);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('with flag on, skips non-text content entries', () => {
    process.env.ECLASS_MCP_SOFT_OUTPUT_VALIDATION = '1';
    const result = {
      content: [
        { type: 'text' as const, text: '{"x":1}' },
        {
          type: 'image' as const,
          data: 'abc',
          mimeType: 'image/png',
        },
      ],
    };
    expect(applySoftOutputValidation('t', result)).toBe(result);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
