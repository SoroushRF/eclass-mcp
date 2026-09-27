import { describe, expect, it } from 'vitest';
import {
  compareAnnouncementCanary,
  compareAssignmentIndexCanary,
  compareGradeCanary,
} from '../src/scraper/eclass/api/canary';
import {
  htmlToPlainText,
  mapRestAssignments,
  mapRestForumDiscussions,
  mapRestGradeItems,
  mapRestOverviewGrades,
  mapRestUserCourses,
} from '../src/scraper/eclass/api/rest-mappers';
import type {
  Announcement,
  DeadlineItem,
  Grade,
} from '../src/scraper/eclass/types';

const ORIGIN = 'https://eclass.yorku.ca';

function grade(overrides: Partial<Grade> = {}): Grade {
  return {
    courseId: '101',
    itemName: 'Quiz 1',
    grade: '8.00',
    range: '0–10',
    percentage: '80.00 %',
    feedback: '',
    ...overrides,
  };
}

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: '1',
    title: 'Welcome',
    content: 'x',
    date: '',
    author: '',
    links: [],
    ...overrides,
  };
}

function item(overrides: Partial<DeadlineItem> = {}): DeadlineItem {
  return {
    id: '12',
    name: 'A1',
    dueDate: '',
    status: 'No submission',
    courseId: '101',
    url: `${ORIGIN}/mod/assign/view.php?id=12`,
    type: 'assign',
    ...overrides,
  };
}

describe('REST shadow comparators', () => {
  it('compares grade items by course and normalized name, then value', () => {
    expect(
      compareGradeCanary(
        [grade()],
        [grade({ itemName: '  quiz   1 ', grade: '8.00' })]
      )
    ).toMatchObject({ passed: true, apiCount: 1, playwrightCount: 1 });

    expect(
      compareGradeCanary([grade()], [grade({ grade: '7.00' })])
        .mismatchCategories
    ).toEqual(['grade_value']);

    expect(
      compareGradeCanary([grade(), grade({ itemName: 'Quiz 2' })], [grade()])
        .mismatchCategories
    ).toEqual(['count', 'grade_item_set']);
  });

  it('compares announcements by discussion id, then title', () => {
    expect(
      compareAnnouncementCanary([announcement()], [announcement()]).passed
    ).toBe(true);
    expect(
      compareAnnouncementCanary(
        [announcement()],
        [announcement({ title: 'Changed' })]
      ).mismatchCategories
    ).toEqual(['title_mismatch']);
    expect(
      compareAnnouncementCanary([announcement()], [announcement({ id: '2' })])
        .mismatchCategories
    ).toEqual(['discussion_set']);
    expect(
      compareAnnouncementCanary([], [announcement()]).mismatchCategories
    ).toEqual(['count', 'discussion_set']);
  });

  it('compares the assignment index by id and submission status', () => {
    expect(compareAssignmentIndexCanary([item()], [item()]).passed).toBe(true);
    expect(
      compareAssignmentIndexCanary(
        [item()],
        [item({ status: 'Submitted for grading' })]
      ).mismatchCategories
    ).toEqual(['submission_status']);
    expect(
      compareAssignmentIndexCanary([item()], [item({ id: '99' })])
        .mismatchCategories
    ).toEqual(['assignment_set']);
  });
});

describe('REST mapper edge cases', () => {
  it('decodes numeric and unknown entities safely', () => {
    expect(htmlToPlainText('&#65;&#x42;&unknown;&hellip;')).toBe(
      'AB&unknown;…'
    );
    expect(htmlToPlainText(undefined)).toBe('');
  });

  it('names category totals and falls back for empty item names', () => {
    const grades = mapRestGradeItems({
      usergrades: [
        {
          courseid: 5,
          gradeitems: [
            { itemtype: 'category', itemname: 'Labs' },
            { itemtype: 'category', itemname: '' },
            { itemtype: 'mod', itemname: '' },
          ],
        },
      ],
    });
    expect(grades.map((entry) => entry.itemName)).toEqual([
      'Labs total',
      'Category total',
      'Item',
    ]);
    expect(grades[0]).toMatchObject({
      grade: '-',
      range: '-',
      percentage: '-',
      feedback: '',
    });
  });

  it('skips hidden courses and names courses without titles', () => {
    expect(
      mapRestUserCourses(
        [
          { id: 1, fullname: 'Shown', visible: 1 },
          { id: 2, fullname: 'Hidden', visible: 0 },
          { id: 3, fullname: 'Also hidden', hidden: true },
          { id: 4, idnumber: 'ID-4' },
        ],
        ORIGIN
      ).map((course) => [course.id, course.name, course.courseCode])
    ).toEqual([
      ['1', 'Shown', undefined],
      ['4', 'Course 4', 'ID-4'],
    ]);
    expect(mapRestOverviewGrades({ grades: [] }, [])).toEqual([]);
  });

  it('handles discussions and assignments with missing fields', () => {
    const [discussion] = mapRestForumDiscussions(
      { discussions: [{ id: 1, discussion: 2 }] },
      ORIGIN,
      5
    );
    expect(discussion).toMatchObject({
      id: '2',
      title: 'Untitled',
      content: 'Could not fetch content.',
      date: '',
      author: '',
      links: [],
    });
    expect(mapRestForumDiscussions({ discussions: [] }, ORIGIN, -1)).toEqual(
      []
    );

    const [assignment] = mapRestAssignments(
      {
        courses: [{ id: 7, assignments: [{ id: 70, cmid: 71, duedate: -5 }] }],
      },
      ORIGIN,
      new Map()
    );
    expect(assignment).toMatchObject({
      id: '71',
      name: 'Assignment 71',
      dueDate: '',
      // No status was read for this assignment, so its state is unknown.
      status: 'Unknown (status unavailable)',
      grade: '-',
      courseId: '7',
    });
  });
});
