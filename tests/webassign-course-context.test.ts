import { describe, expect, it } from 'vitest';
import {
  verifyWebAssignCourseContext,
  type WebAssignCourseContext,
} from '../src/scraper/cengage/course-context';

const MATH_COURSE = {
  title: 'MATH 1014 O',
  courseKey: 'WA-production-1607530',
  launchUrl:
    'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
  platform: 'webassign' as const,
  confidence: 0.99,
};

describe('WebAssign course context verification', () => {
  it('rejects a MATH launch URL when WebAssign active context is PHYS', () => {
    const context: WebAssignCourseContext = {
      pageUrl:
        'https://www.webassign.net/v4cgi/student.pl?action=home/index&course=1226089,1607530&UserPass=test',
      pageTitle: 'PHYS 1800 Fall 2025 Final, Fall 2025 - Home | WebAssign',
      currentSelected: '1199639,1577413',
      currentCourseTitle: 'PHYS 1800 Fall 2025 Final, Fall 2025',
      dataCourses: {
        '1199639,1577413': {
          course: 'PHYS 1800 Fall 2025 Final',
          term: 'Fall 2025',
        },
      },
      courseMenuLinks: [
        {
          title: 'MATH 1014 O',
          href: MATH_COURSE.launchUrl,
          courseKey: 'WA-production-1607530',
        },
        {
          title: 'PHYS 1800 Fall 2025 Final',
          href: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1577413',
          courseKey: 'WA-production-1577413',
        },
      ],
    };

    const result = verifyWebAssignCourseContext({
      expectedCourse: MATH_COURSE,
      actual: context,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('course_context_mismatch');
      expect(result.diagnostics.actualCurrentSelected).toBe(
        '1199639,1577413'
      );
    }
  });

  it('accepts a verified MATH active context', () => {
    const context: WebAssignCourseContext = {
      pageUrl:
        'https://www.webassign.net/v4cgi/student.pl?action=home/index&course=1226089,1607530&UserPass=test',
      pageTitle: 'MATH 1014, section O, Winter 2026 - My Assignments | WebAssign',
      currentSelected: '1226089,1607530',
      currentCourseTitle: 'MATH 1014, section O, Winter 2026',
      dataCourses: {
        '1226089,1607530': {
          course: 'MATH 1014',
          section: 'O',
          term: 'Winter 2026',
        },
      },
      courseMenuLinks: [
        {
          title: 'MATH 1014 O',
          href: MATH_COURSE.launchUrl,
          courseKey: 'WA-production-1607530',
        },
      ],
    };

    const result = verifyWebAssignCourseContext({
      expectedCourse: MATH_COURSE,
      actual: context,
    });

    expect(result).toEqual({ ok: true });
  });
});
