import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseEClassDate } from '../src/tools/eclass-service';

describe('parseEClassDate properties', () => {
  it('parses generated ISO calendar dates into matching UTC day parts', () => {
    fc.assert(
      fc.property(
        fc
          .date({
            min: new Date('2020-01-01T00:00:00.000Z'),
            max: new Date('2035-12-31T00:00:00.000Z'),
          })
          .filter((date) => Number.isFinite(date.getTime())),
        (date) => {
          const isoDate = date.toISOString().slice(0, 10);
          const parsed = parseEClassDate(isoDate);
          expect(parsed).not.toBeNull();
          expect(parsed?.toISOString().slice(0, 10)).toBe(isoDate);
        }
      )
    );
  });

  it('returns null for generated strings without date-like content', () => {
    fc.assert(
      fc.property(
        fc
          .string({ maxLength: 40 })
          .filter((value) => !/\d/.test(value) && !/[A-Za-z]{3,}/.test(value)),
        (value) => {
          expect(parseEClassDate(value)).toBeNull();
        }
      )
    );
  });
});
