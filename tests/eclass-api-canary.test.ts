import { describe, expect, it } from 'vitest';
import {
  assertCanaryPassed,
  canaryInstant,
  compareAnnouncementCanary,
  compareAssignmentIndexCanary,
  compareCourseCanary,
  compareCourseContentCanary,
  compareDeadlineCanary,
  compareGradeCanary,
} from '../src/scraper/eclass/api/canary';
import type { Announcement, Grade } from '../src/scraper/eclass/types';
import type { DeadlineItem } from '../src/types/deadlines';

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
    expect(() => assertCanaryPassed(passing, 'courses')).not.toThrow();

    const failing = compareCourseCanary(
      [course],
      [{ ...course, name: 'Different course' }]
    );
    expect(failing.passed).toBe(false);
    expect(failing.mismatchCategories).toEqual(
      expect.arrayContaining(['course_set'])
    );
    expect(() => assertCanaryPassed(failing, 'courses')).toThrow(
      /courses canary failed/
    );
  });

  it('compares section titles, membership and module multiplicity', () => {
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

    expect(compareCourseContentCanary(api, api)).toMatchObject({
      passed: true,
      mismatchCategories: [],
    });
    expect(compareCourseContentCanary(api, html).mismatchCategories).toEqual([
      'section_title',
    ]);
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
    expect(
      compareCourseContentCanary(api, {
        ...html,
        sections: [...html.sections, { title: 'Week 2', items: [] }],
      }).mismatchCategories
    ).toContain('section_count');
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
      compareDeadlineCanary(
        [item],
        [{ ...item, dueDate: '2026-05-28T20:26:41.000Z' }]
      ).mismatchCategories
    ).toContain('due_date');
    expect(compareDeadlineCanary([item], []).mismatchCategories).toEqual(
      expect.arrayContaining(['count', 'deadline_set'])
    );
    expect(
      compareDeadlineCanary([item], [{ ...item, dueDate: 'soon' }])
        .mismatchCategories
    ).toEqual(['due_date_unverified']);
  });

  it('detects equal-size module sets that differ, and moved modules', () => {
    const item = (id: number) => ({
      type: 'resource' as const,
      name: `Reading ${id}`,
      url: `https://eclass.yorku.ca/mod/resource/view.php?id=${id}`,
    });
    const api = {
      courseId: '101',
      sections: [
        { title: 'Week 1', items: [item(1), item(2)] },
        { title: 'Week 2', items: [item(3)] },
      ],
    };

    expect(
      compareCourseContentCanary(api, {
        ...api,
        sections: [
          { title: 'Week 1', items: [item(1), item(1)] },
          { title: 'Week 2', items: [item(3)] },
        ],
      }).mismatchCategories
    ).toEqual(['section_membership', 'visible_module_set']);
    expect(
      compareCourseContentCanary(api, {
        ...api,
        sections: [
          { title: 'Week 1', items: [item(1)] },
          { title: 'Week 2', items: [item(2), item(3)] },
        ],
      }).mismatchCategories
    ).toEqual(['section_membership']);
    expect(
      compareCourseContentCanary(
        { ...api, external_platforms: [] },
        {
          ...api,
          external_platforms: [
            { name: 'WebAssign', url: 'https://www.webassign.net/' },
          ],
        }
      ).mismatchCategories
    ).toEqual(['external_platforms']);
  });

  it('counts duplicate courses', () => {
    expect(
      compareCourseCanary([course, course], [course, { ...course, id: '102' }])
        .mismatchCategories
    ).toEqual(['course_set']);
  });
});

describe('eClass canary field comparison', () => {
  const grade: Grade = {
    courseId: '101',
    itemName: 'Quiz 1',
    grade: '8.00',
    range: '0–10',
    percentage: '80.00 %',
    feedback: 'Good work',
  };

  it('compares every grade field and counts duplicate item names', () => {
    expect(compareGradeCanary([grade], [{ ...grade }]).passed).toBe(true);
    for (const [change, category] of [
      [{ grade: '9.00' }, 'grade_value'],
      [{ range: '0–20' }, 'grade_range'],
      [{ percentage: '40.00 %' }, 'grade_percentage'],
      [{ feedback: 'See me' }, 'grade_feedback'],
    ] as const) {
      expect(
        compareGradeCanary([grade], [{ ...grade, ...change }])
          .mismatchCategories
      ).toEqual([category]);
    }
    const second = { ...grade, grade: '5.00' };
    expect(
      compareGradeCanary([grade, second], [grade, grade]).mismatchCategories
    ).toEqual(['grade_value']);
    expect(
      compareGradeCanary([grade, grade], [grade]).mismatchCategories
    ).toEqual(['count', 'grade_item_set']);
  });

  const announcement: Announcement = {
    id: 'd1',
    title: 'Midterm',
    content: 'The midterm is\nin room 101.',
    date: '2026-09-20T14:00:00.000Z',
    author: 'Instructor',
    links: [
      {
        name: 'Syllabus',
        url: 'https://eclass.yorku.ca/syllabus',
        sourceDiscussionUrl:
          'https://eclass.yorku.ca/mod/forum/discuss.php?d=1',
      },
    ],
  };

  it('compares announcement content, author, links and date', () => {
    expect(
      compareAnnouncementCanary(
        [announcement],
        [{ ...announcement, content: 'The midterm is in room 101.' }]
      ).passed
    ).toBe(true);
    for (const [change, category] of [
      [{ content: 'Cancelled.' }, 'content_mismatch'],
      [{ author: 'Someone else' }, 'author_mismatch'],
      [{ links: [] as Announcement['links'] }, 'links_mismatch'],
      [{ date: '2026-09-21T14:00:00.000Z' }, 'date_mismatch'],
      [{ date: 'yesterday-ish' }, 'date_mismatch_unverified'],
      [{ title: 'Final' }, 'title_mismatch'],
    ] as const) {
      expect(
        compareAnnouncementCanary(
          [announcement],
          [{ ...announcement, ...change }]
        ).mismatchCategories
      ).toEqual([category]);
    }
  });

  const indexItem: DeadlineItem = {
    id: 'a1',
    name: 'Lab 1',
    dueDate: '2026-10-02T03:59:00.000Z',
    status: 'Open',
    courseId: '101',
    url: 'https://eclass.yorku.ca/mod/assign/view.php?id=1',
    type: 'assign',
    section: 'Week 1',
    submission: 'Submitted for grading',
    grade: '80.00 / 100.00',
  };

  it('compares the assignment index contract field by field', () => {
    expect(
      compareAssignmentIndexCanary([indexItem], [{ ...indexItem }]).passed
    ).toBe(true);
    for (const [change, category] of [
      [{ submission: 'No submission' }, 'submission_state'],
      [{ status: 'Closed' }, 'submission_status'],
      [{ dueDate: '2026-10-09T03:59:00.000Z' }, 'due_date'],
      [{ dueDate: 'Not a date' }, 'due_date_unverified'],
      [{ grade: '0.00 / 100.00' }, 'grade'],
      [{ grade: '-' }, 'grade'],
      [{ courseId: '999' }, 'course'],
      [{ section: 'Week 8' }, 'section'],
      [{ section: '' }, 'section'],
      [{ url: 'https://eclass.yorku.ca/mod/assign/view.php?id=999' }, 'url'],
      [{ type: 'quiz' }, 'type'],
      [{ name: 'Lab 2' }, 'name'],
    ] as const) {
      expect(
        compareAssignmentIndexCanary([indexItem], [{ ...indexItem, ...change }])
          .mismatchCategories
      ).toEqual([category]);
    }
  });

  it('reproduces the review case: grade, course, section and URL all changed', () => {
    const changed = {
      ...indexItem,
      url: 'https://eclass.yorku.ca/mod/assign/view.php?id=999',
      courseId: '999',
      courseName: 'Course B',
      section: 'Week 8',
      grade: '0',
    };
    const result = compareAssignmentIndexCanary([indexItem], [changed]);
    expect(result.passed).toBe(false);
    expect(result.mismatchCategories).toEqual(
      expect.arrayContaining(['grade', 'course', 'section', 'url'])
    );
  });

  it('treats blank and "-" grades, and URL parameter order, as equal', () => {
    const noGrade = { ...indexItem, grade: '' };
    expect(
      compareAssignmentIndexCanary([noGrade], [{ ...noGrade, grade: '-' }])
        .passed
    ).toBe(true);
    const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=1&action=view';
    expect(
      compareAssignmentIndexCanary(
        [{ ...indexItem, url }],
        [
          {
            ...indexItem,
            url: 'https://eclass.yorku.ca/mod/assign/view.php?action=view&id=1',
          },
        ]
      ).passed
    ).toBe(true);
  });

  it('keeps word boundaries when comparing body text', () => {
    const base = {
      id: 'd1',
      title: 'T',
      content: 'Meet in room 101 today',
      author: 'A',
      date: '2026-09-20T14:00:00.000Z',
      links: [] as Announcement['links'],
    } as Announcement;
    expect(
      compareAnnouncementCanary(
        [base],
        [{ ...base, content: '  Meet in\nroom 101   today ' }]
      ).passed
    ).toBe(true);
    expect(
      compareAnnouncementCanary(
        [base],
        [{ ...base, content: 'Meet in room 1 01 today' }]
      ).mismatchCategories
    ).toEqual(['content_mismatch']);
  });

  it('reads display dates to the minute', () => {
    const iso = canaryInstant('2026-10-01T23:59:00');
    expect(canaryInstant('Thursday, 1 October 2026, 11:59 PM')).toBe(iso);
    expect(canaryInstant('')).toBeNull();
    expect(canaryInstant('Due soon')).toBeNull();
  });
});
