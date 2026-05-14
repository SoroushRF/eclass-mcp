import { describe, expect, it } from 'vitest';
import {
  compactCourseCode,
  resolveCengageCourseForEclass,
  spacedCourseCode,
} from '../src/tools/assignments/course-matcher';
import type { CengageDashboardCourse } from '../src/scraper/cengage-courses';

const baseCourse: CengageDashboardCourse = {
  title: 'MATH 1014 O',
  launchUrl:
    'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
  courseKey: 'WA-production-1607530',
  platform: 'webassign',
  confidence: 0.95,
};

describe('cross-platform course matcher', () => {
  it('normalizes compact and spaced course codes', () => {
    expect(compactCourseCode('MATH 1014 O')).toBe('MATH1014O');
    expect(spacedCourseCode('MATH1014')).toBe('MATH 1014');
  });

  it('matches compact eClass codes to spaced Cengage dashboard titles', () => {
    const result = resolveCengageCourseForEclass({
      eclassCourse: {
        courseId: '101',
        courseCode: 'MATH1014',
        courseName: 'MATH 1014',
      },
      cengageCourses: [baseCourse],
    });

    expect(result.status).toBe('selected');
    if (result.status === 'selected') {
      expect(result.selectedCourse.courseKey).toBe('WA-production-1607530');
      expect(result.selectedBy).toBe('auto_match');
    }
  });

  it('returns ambiguous when more than one Cengage course matches the eClass code', () => {
    const result = resolveCengageCourseForEclass({
      eclassCourse: {
        courseCode: 'MATH1014',
      },
      cengageCourses: [
        baseCourse,
        {
          ...baseCourse,
          title: 'MATH 1014 N',
          courseKey: 'WA-production-1607531',
          launchUrl:
            'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607531',
        },
      ],
    });

    expect(result.status).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('lets explicit courseKey selection win', () => {
    const result = resolveCengageCourseForEclass({
      eclassCourse: {
        courseCode: 'MATH1014',
      },
      cengageCourses: [
        baseCourse,
        {
          ...baseCourse,
          title: 'MATH 1014 N',
          courseKey: 'WA-production-1607531',
          launchUrl:
            'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607531',
        },
      ],
      selection: {
        courseKey: 'WA-production-1607531',
      },
    });

    expect(result.status).toBe('selected');
    if (result.status === 'selected') {
      expect(result.selectedCourse.courseKey).toBe('WA-production-1607531');
      expect(result.selectedBy).toBe('user_selection');
    }
  });

  it('returns not_found when no candidate matches', () => {
    const result = resolveCengageCourseForEclass({
      eclassCourse: {
        courseCode: 'EECS2030',
      },
      cengageCourses: [baseCourse],
    });

    expect(result.status).toBe('not_found');
  });
});
