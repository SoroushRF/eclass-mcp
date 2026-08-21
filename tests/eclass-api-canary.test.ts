import { describe, expect, it } from 'vitest';
import {
  assertCanaryPassed,
  compareCourseCanary,
  compareCourseContentCanary,
  compareDeadlineCanary,
} from '../src/scraper/eclass/api/canary';

const course = {
  id: '101',
  name: 'CPSC 1010',
  courseCode: 'CPSC1010',
  url: 'https://eclass.yorku.ca/course/view.php?id=101',
};

describe('eClass hybrid canary gates', () => {
  it('requires exact normalized course-set agreement', () => {
    const passing = compareCourseCanary([course], [{ ...course }]);
    expect(passing).toMatchObject({
      passed: true,
      mismatchCategories: [],
      apiCount: 1,
      playwrightCount: 1,
    });
    expect(() =>
      assertCanaryPassed(passing, 'courses')
    ).not.toThrow();

    const failing = compareCourseCanary([course], [
      { ...course, name: 'Different course' },
    ]);
    expect(failing.passed).toBe(false);
    expect(failing.mismatchCategories).toEqual(
      expect.arrayContaining(['course_set'])
    );
    expect(() => assertCanaryPassed(failing, 'courses')).toThrow(
      /courses canary failed/
    );
  });

  it('compares content structurally while ignoring prose outside the outline', () => {
    const api = {
      courseId: '101',
      sections: [
        {
          title: 'Week 1',
          items: [
            {
              type: 'resource' as const,
              name: 'Reading',
              url: 'https://eclass.yorku.ca/mod/resource/view.php?id=11',
            },
          ],
        },
      ],
    };
    const html = {
      ...api,
      sections: api.sections.map((section) => ({
        ...section,
        title: 'Different presentation title',
      })),
    };

    expect(compareCourseContentCanary(api, html)).toMatchObject({
      passed: true,
      mismatchCategories: [],
    });
    expect(
      compareCourseContentCanary(api, {
        ...html,
        sections: [
          {
            ...html.sections[0]!,
            items: [],
          },
        ],
      }).mismatchCategories
    ).toContain('visible_module_set');
  });

  it('requires stable deadline IDs and exact normalized timestamps', () => {
    const item = {
      id: 'event-1',
      name: 'Assignment',
      dueDate: '2026-05-28T20:26:40.000Z',
      status: 'Upcoming',
      courseId: '101',
      url: 'https://eclass.yorku.ca/mod/assign/view.php?id=11',
    };

    expect(compareDeadlineCanary([item], [{ ...item }]).passed).toBe(true);
    expect(
      compareDeadlineCanary([item], [
        { ...item, dueDate: '2026-05-28T20:26:41.000Z' },
      ]).mismatchCategories
    ).toContain('timestamp_mismatch');
    expect(
      compareDeadlineCanary([item], []).mismatchCategories
    ).toEqual(expect.arrayContaining(['count', 'missing_deadline']));
  });
});
