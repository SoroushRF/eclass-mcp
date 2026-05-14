import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  collectWebAssignCourseContext,
  compactCourseCode,
  courseCodeCandidates,
  inferCourseKeyFromContextUrl,
  normalizeComparableTitle,
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
  it('normalizes comparable titles and course-code candidates', () => {
    expect(
      normalizeComparableTitle('  MATH 1014 O - My Assignments | WebAssign  ')
    ).toBe('math 1014 o');
    expect(compactCourseCode('Math 1014-O')).toBe('MATH1014O');
    expect(
      courseCodeCandidates('SC/MATH1014 and PHYS 1801 are visible')
    ).toEqual(['MATH1014', 'PHYS1801']);
  });

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
      expect(result.diagnostics.actualCurrentSelected).toBe('1199639,1577413');
    }
  });

  it('accepts a verified MATH active context', () => {
    const context: WebAssignCourseContext = {
      pageUrl:
        'https://www.webassign.net/v4cgi/student.pl?action=home/index&course=1226089,1607530&UserPass=test',
      pageTitle:
        'MATH 1014, section O, Winter 2026 - My Assignments | WebAssign',
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

  it('accepts generic WebAssign pages when no concrete active title is available', () => {
    const result = verifyWebAssignCourseContext({
      expectedCourse: {
        ...MATH_COURSE,
        title: 'WebAssign',
        courseKey: undefined,
      },
      actual: {
        pageUrl: MATH_COURSE.launchUrl,
        pageTitle: 'WebAssign',
        currentCourseTitle: 'WebAssign',
        courseMenuLinks: [],
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects mismatched active title even when the expected course appears in the menu', () => {
    const result = verifyWebAssignCourseContext({
      expectedCourse: MATH_COURSE,
      actual: {
        pageUrl: MATH_COURSE.launchUrl,
        pageTitle: 'PHYS 1801 M & N - Home | WebAssign',
        currentCourseTitle: 'PHYS 1801 M & N',
        currentSelected: 'phys-1801',
        courseMenuLinks: [
          {
            title: 'MATH 1014 O',
            href: MATH_COURSE.launchUrl,
            courseKey: MATH_COURSE.courseKey,
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.expectedCodes).toContain('MATH1014');
      expect(result.diagnostics.actualCodes).toContain('PHYS1801');
    }
  });

  it('infers course keys from context URLs safely', () => {
    expect(
      inferCourseKeyFromContextUrl({
        pageUrl: MATH_COURSE.launchUrl,
        pageTitle: 'WebAssign',
        courseMenuLinks: [],
      })
    ).toBe('WA-production-1607530');
    expect(
      inferCourseKeyFromContextUrl({
        pageUrl: 'not a url',
        pageTitle: 'WebAssign',
        courseMenuLinks: [],
      })
    ).toBeUndefined();
  });

  it('collects active course context from WebAssign DOM attributes', async () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>MATH 1014 O - Home | WebAssign</title></head>
          <body>
            <div
              data-current-selected="1226089,1607530"
              data-courses='{"1226089,1607530":{"course":"MATH 1014","section":"O","term":"Winter 2026"}}'
            >
              CURRENT COURSE MATH 1014 O Instructor: Shohreh Rahmati Home
            </div>
            <a href="/v4cgi/login.pl?courseKey=WA-production-1607530">MATH 1014 O</a>
            <a href="/v4cgi/login.pl?courseKey=WA-production-1577413">PHYS 1800</a>
          </body>
        </html>
      `,
      { url: 'https://www.webassign.net/v4cgi/student.pl?action=home/index' }
    );

    const fakePage = {
      evaluate<T>(fn: () => T): T {
        const previousWindow = (globalThis as any).window;
        const previousDocument = (globalThis as any).document;
        (globalThis as any).window = dom.window;
        (globalThis as any).document = dom.window.document;
        try {
          return fn();
        } finally {
          (globalThis as any).window = previousWindow;
          (globalThis as any).document = previousDocument;
        }
      },
    };

    const context = await collectWebAssignCourseContext(fakePage as any);

    expect(context.currentSelected).toBe('1226089,1607530');
    expect(context.currentCourseTitle).toBe('MATH 1014, O, Winter 2026');
    expect(context.courseMenuLinks).toEqual([
      expect.objectContaining({
        title: 'MATH 1014 O',
        courseKey: 'WA-production-1607530',
      }),
      expect.objectContaining({
        title: 'PHYS 1800',
        courseKey: 'WA-production-1577413',
      }),
    ]);
  });

  it('falls back to visible current-course text when data-courses is malformed', async () => {
    const dom = new JSDOM(
      `
        <html>
          <head><title>WebAssign</title></head>
          <body>
            <div data-current-selected="broken" data-courses="{nope">
              CURRENT COURSE CHEM 1100 Sec N Grades
            </div>
          </body>
        </html>
      `,
      { url: 'https://www.webassign.net/v4cgi/student.pl' }
    );

    const fakePage = {
      evaluate<T>(fn: () => T): T {
        const previousWindow = (globalThis as any).window;
        const previousDocument = (globalThis as any).document;
        (globalThis as any).window = dom.window;
        (globalThis as any).document = dom.window.document;
        try {
          return fn();
        } finally {
          (globalThis as any).window = previousWindow;
          (globalThis as any).document = previousDocument;
        }
      },
    };

    const context = await collectWebAssignCourseContext(fakePage as any);

    expect(context.currentSelected).toBe('broken');
    expect(context.dataCourses).toBeUndefined();
    expect(context.currentCourseTitle).toBe('CHEM 1100 Sec N');
    expect(context.courseMenuLinks).toEqual([]);
  });
});
