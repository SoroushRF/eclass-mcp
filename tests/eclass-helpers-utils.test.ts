import { describe, expect, it } from 'vitest';
import {
  buildCourseMetadata,
  extractCourseCode,
  inferItemType,
  normalizeWhitespace,
  sanitizeHttpUrlQueryParams,
  toDeadlineItem,
} from '../src/scraper/eclass/helpers';

describe('eclass helper utility functions', () => {
  it('normalizes whitespace and extracts course code patterns', () => {
    expect(normalizeWhitespace('  MATH   1010   A  ')).toBe('MATH 1010 A');
    expect(extractCourseCode('MATH 1010 A - Calculus')).toBe('MATH1010');
    expect(extractCourseCode('SC-NATS 1510')).toBe('NATS1510');
    expect(extractCourseCode('General announcements')).toBeUndefined();
  });

  it('builds course metadata with cleaned names and inferred code', () => {
    expect(buildCourseMetadata('123', '  BIOL   2020  Intro Biology  ')).toEqual({
      courseId: '123',
      courseName: 'BIOL 2020 Intro Biology',
      courseCode: 'BIOL2020',
    });

    expect(buildCourseMetadata('456')).toEqual({
      courseId: '456',
      courseName: undefined,
      courseCode: undefined,
    });
  });

  it('sanitizes valid URL query params and strips empty values', () => {
    const sanitized = sanitizeHttpUrlQueryParams(
      ' https://eclass.yorku.ca/mod/page/view.php?id= 148310   &forcedownload=   '
    );

    expect(sanitized).toBe(
      'https://eclass.yorku.ca/mod/page/view.php?id=148310'
    );
  });

  it('falls back to whitespace stripping for non-URL text', () => {
    expect(sanitizeHttpUrlQueryParams(' not a url with spaces ')).toBe(
      'notaurlwithspaces'
    );
  });

  it('infers deadline item type from Moodle URLs and fallback words', () => {
    expect(inferItemType('https://eclass.yorku.ca/mod/assign/view.php?id=1')).toBe(
      'assign'
    );
    expect(inferItemType('https://eclass.yorku.ca/mod/quiz/view.php?id=2')).toBe(
      'quiz'
    );
    expect(inferItemType('https://example.org/my-assignments')).toBe('assign');
    expect(inferItemType('https://example.org/quiz-review')).toBe('quiz');
    expect(inferItemType('https://example.org/reading')).toBe('other');
  });

  it('maps assignment records into deadline items with inferred type', () => {
    const item = toDeadlineItem({
      id: 'a1',
      name: 'Assignment 1',
      dueDate: '2026-03-10T23:59:00.000Z',
      status: 'open',
      courseId: '101',
      courseName: 'MATH 1010',
      url: 'https://eclass.yorku.ca/mod/assign/view.php?id=99',
    });

    expect(item).toEqual({
      id: 'a1',
      name: 'Assignment 1',
      dueDate: '2026-03-10T23:59:00.000Z',
      status: 'open',
      courseId: '101',
      courseName: 'MATH 1010',
      url: 'https://eclass.yorku.ca/mod/assign/view.php?id=99',
      type: 'assign',
    });
  });
});
