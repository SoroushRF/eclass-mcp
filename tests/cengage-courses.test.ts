import { describe, expect, it } from 'vitest';
import {
  extractDashboardCourses,
  extractDashboardCoursesFromCardCandidates,
  inferCourseFromCurrentPage,
  resolveDashboardCourseSelection,
  type CengageDashboardCourse,
} from '../src/scraper/cengage-courses';

const SAMPLE_COURSES: CengageDashboardCourse[] = [
  {
    courseId: 'course-001',
    courseKey: 'WA-production-1001',
    title: 'MATH 1010 - Calculus I',
    launchUrl:
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
    platform: 'webassign',
    confidence: 0.95,
  },
  {
    courseId: 'course-002',
    courseKey: 'WA-production-1002',
    title: 'MATH 1010 - Calculus II',
    launchUrl:
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1002',
    platform: 'webassign',
    confidence: 0.93,
  },
  {
    courseId: 'bio-abc',
    title: 'Biology: Intro to Cells',
    launchUrl:
      'https://www.cengage.com/mindtap/course/bio-abc?courseId=bio-abc',
    platform: 'cengage',
    confidence: 0.8,
  },
];

describe('cengage dashboard course inventory extraction', () => {
  it('prefers card title over generic launch text for dashboard cards', () => {
    const courses = extractDashboardCoursesFromCardCandidates(
      [
        {
          cardId: 'home-page-entitlement-card-0',
          cardTitle: 'MATH 1014 O',
          launchHref:
            'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-9009',
          launchText: 'OPEN WEBASSIGN',
          dataCourseKey: 'WA-production-9009',
        },
      ],
      'https://www.cengage.ca/dashboard/home'
    );

    expect(courses).toHaveLength(1);
    expect(courses[0].title).toBe('MATH 1014 O');
    expect(courses[0].launchUrl).toBe(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-9009'
    );
    expect(courses[0].courseKey).toBe('WA-production-9009');
  });

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

  it('ignores getenrolled registration wrappers as course inventory rows', () => {
    const courses = extractDashboardCourses(
      [
        {
          href: 'https://www.getenrolled.com/?courseKey=yorku.ca73866101',
          text: 'OPEN WEBASSIGN',
        },
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

  it('uses aria-label course name when launch text is generic', () => {
    const courses = extractDashboardCourses(
      [
        {
          href: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
          text: 'OPEN WEBASSIGN',
          ariaLabel: 'OPEN WEBASSIGN for MATH 1014 O, Opens in a New Window',
        },
      ],
      'https://www.cengage.ca/dashboard/home'
    );

    expect(courses).toHaveLength(1);
    expect(courses[0].courseKey).toBe('WA-production-1607530');
    expect(courses[0].title).toBe('MATH 1014 O');
    expect(courses[0].confidence).toBeGreaterThan(0.8);
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

  it('returns null for getenrolled registration wrappers', () => {
    const course = inferCourseFromCurrentPage(
      'https://www.getenrolled.com/?courseKey=yorku.ca73866101',
      'OPEN WEBASSIGN'
    );

    expect(course).toBeNull();
  });
});

describe('cengage course selection resolver', () => {
  it('matches by courseId first when provided', () => {
    const result = resolveDashboardCourseSelection(SAMPLE_COURSES, {
      courseId: 'course-002',
      courseQuery: 'MATH 1010 - Calculus I',
    });

    expect(result.status).toBe('selected');
    expect(result.strategy).toBe('course_id');
    expect(result.selectedCourse?.courseId).toBe('course-002');
  });

  it('matches by courseKey when courseId is not provided', () => {
    const result = resolveDashboardCourseSelection(SAMPLE_COURSES, {
      courseKey: 'wa-production-1001',
    });

    expect(result.status).toBe('selected');
    expect(result.strategy).toBe('course_key');
    expect(result.selectedCourse?.courseKey).toBe('WA-production-1001');
  });

  it('uses exact title match before fuzzy fallback', () => {
    const result = resolveDashboardCourseSelection(SAMPLE_COURSES, {
      courseQuery: 'MATH 1010 - Calculus II',
    });

    expect(result.status).toBe('selected');
    expect(result.strategy).toBe('exact_title');
    expect(result.selectedCourse?.title).toBe('MATH 1010 - Calculus II');
  });

  it('uses normalized title match when punctuation differs', () => {
    const result = resolveDashboardCourseSelection(SAMPLE_COURSES, {
      courseQuery: 'biology intro to cells',
    });

    expect(result.status).toBe('selected');
    expect(result.strategy).toBe('normalized_title');
    expect(result.selectedCourse?.courseId).toBe('bio-abc');
  });

  it('returns ambiguous instead of silently selecting on close fuzzy matches', () => {
    const result = resolveDashboardCourseSelection(SAMPLE_COURSES, {
      courseQuery: 'math 1010 calculus',
    });

    expect(result.status).toBe('ambiguous');
    expect(result.strategy).toBe('fuzzy_title');
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it('returns selection_required when multiple courses exist and no selector is provided', () => {
    const result = resolveDashboardCourseSelection(SAMPLE_COURSES, {});

    expect(result.status).toBe('selection_required');
    expect(result.selectedCourse).toBeUndefined();
    expect(result.candidates).toHaveLength(3);
  });

  it('auto-selects when only one course is available', () => {
    const result = resolveDashboardCourseSelection([SAMPLE_COURSES[0]], {});

    expect(result.status).toBe('selected');
    expect(result.strategy).toBe('single');
    expect(result.selectedCourse?.courseId).toBe('course-001');
  });

  it('returns not_found when selectors do not match any course', () => {
    const result = resolveDashboardCourseSelection(SAMPLE_COURSES, {
      courseId: 'missing-id',
    });

    expect(result.status).toBe('not_found');
    expect(result.strategy).toBe('course_id');
  });
});
