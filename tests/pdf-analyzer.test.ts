import { describe, expect, it } from 'vitest';
import { resolvePdfPageRange } from '../src/parser/pdf-analyzer';

describe('PDF page range validation', () => {
  it('resolves a valid bounded range', () => {
    expect(resolvePdfPageRange(120, 10, 25)).toEqual({
      ok: true,
      firstPage: 10,
      lastPage: 25,
      processedRange: [10, 25],
      isTruncated: true,
    });
  });

  it('caps open-ended ranges to the per-call page limit', () => {
    expect(resolvePdfPageRange(120, 10)).toMatchObject({
      ok: true,
      firstPage: 10,
      lastPage: 59,
      processedRange: [10, 59],
    });
  });

  it('rejects impossible ranges before page analysis', () => {
    expect(resolvePdfPageRange(4, 5)).toMatchObject({
      ok: false,
      message: expect.stringContaining('startPage 5'),
    });
    expect(resolvePdfPageRange(4, 3, 2)).toMatchObject({
      ok: false,
      message: expect.stringContaining('endPage'),
    });
    expect(resolvePdfPageRange(4, 0)).toMatchObject({
      ok: false,
      message: expect.stringContaining('startPage'),
    });
    expect(resolvePdfPageRange(4, 1, 1.5)).toMatchObject({
      ok: false,
      message: expect.stringContaining('endPage'),
    });
  });
});
