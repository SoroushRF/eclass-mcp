import { describe, expect, it } from 'vitest';
import {
  extractDashboardCourses,
  inferCourseFromCurrentPage,
} from '../src/scraper/cengage-courses';

describe('cengage dashboard course inventory extraction', () => {
  it('extracts multiple course links with stable identifiers', () => {
    const courses = extractDashboardCourses(
      [
        {
          href: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1111',
          text: 'MATH 101 - Section A',
        },
        {
          href: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-2222',
          text: 'PHYS 1420 - Winter',
        },
        {
          href: 'https://www.cengage.com/mindtap/course/abc123?courseId=abc123',
          text: 'Biology Course',
        },
      ],
      'https://www.cengage.com/dashboard/home'
    );

    expect(courses).toHaveLength(3);

    const webassign = courses.find(
      (course) => course.courseKey === 'WA-production-1111'
    );
    expect(webassign).toBeDefined();
    expect(webassign?.title).toBe('MATH 101 - Section A');
    expect(webassign?.platform).toBe('webassign');
    expect(webassign?.confidence).toBeGreaterThanOrEqual(0.8);

    const cengage = courses.find((course) => course.courseId === 'abc123');
    expect(cengage).toBeDefined();
    expect(cengage?.launchUrl).toBe(
      'https://www.cengage.com/mindtap/course/abc123?courseId=abc123'
    );
    expect(cengage?.platform).toBe('cengage');
  });

  it('dedupes duplicate links and keeps the best candidate', () => {
    const courses = extractDashboardCourses(
      [
        {
          href: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-3333#overview',
          text: 'Open',
        },
        {
          href: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-3333',
          text: 'CHEM 1000 - Intro Chemistry',
        },
      ],
      'https://www.cengage.com/dashboard/home'
    );

    expect(courses).toHaveLength(1);
    expect(courses[0].courseKey).toBe('WA-production-3333');
    expect(courses[0].title).toBe('CHEM 1000 - Intro Chemistry');
    expect(courses[0].launchUrl).toBe(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-3333'
    );
  });

  it('ignores unrelated links and non-http protocols', () => {
    const courses = extractDashboardCourses(
      [
        { href: 'https://example.org/page', text: 'External Site' },
        { href: 'mailto:help@example.org', text: 'Email Help' },
        { href: '/account/settings', text: 'Settings' },
      ],
      'https://www.cengage.com/dashboard/home'
    );

    expect(courses).toHaveLength(0);
  });

  it('uses a deterministic fallback title when link text is missing', () => {
    const courses = extractDashboardCourses(
      [
        {
          href: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-4444',
          text: '  ',
        },
      ],
      'https://www.cengage.com/dashboard/home'
    );

    expect(courses).toHaveLength(1);
    expect(courses[0].title).toBe('WebAssign WA-production-4444');
    expect(courses[0].confidence).toBeGreaterThan(0.6);
  });
});

describe('cengage current-page course inference', () => {
  it('infers a course from direct course URL and page title', () => {
    const course = inferCourseFromCurrentPage(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-5555',
      'MATH 2010 - Calculus II'
    );

    expect(course).toBeDefined();
    expect(course?.courseKey).toBe('WA-production-5555');
    expect(course?.title).toBe('MATH 2010 - Calculus II');
    expect(course?.platform).toBe('webassign');
  });

  it('returns null for unrelated domains', () => {
    const course = inferCourseFromCurrentPage(
      'https://example.org/dashboard/course/123',
      'Example Course'
    );

    expect(course).toBeNull();
  });
});