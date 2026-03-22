import { describe, it, expect } from 'vitest';
import { compareSlideEntryNames } from '../src/parser/pptx';

describe('pptx slide ordering', () => {
  it('orders slide XML paths numerically', () => {
    expect(
      compareSlideEntryNames('ppt/slides/slide2.xml', 'ppt/slides/slide10.xml')
    ).toBeLessThan(0);
    expect(
      compareSlideEntryNames('ppt/slides/slide10.xml', 'ppt/slides/slide2.xml')
    ).toBeGreaterThan(0);
    expect(
      compareSlideEntryNames('ppt/slides/slide3.xml', 'ppt/slides/slide3.xml')
    ).toBe(0);
  });
});
