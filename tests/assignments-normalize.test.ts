import { describe, expect, it } from 'vitest';
import type { CengageDashboardCourse } from '../src/scraper/cengage-courses';
import type { DeadlineItem } from '../src/types/deadlines';
import {
  filterAssignmentsByScope,
  normalizeCengageAssignment,
  normalizeEclassAssignment,
  sortAssignments,
  type NormalizedAssignment,
} from '../src/tools/assignments/normalize';

const ECLASS_DEADLINE: DeadlineItem = {
  id: 'eclass-1',
  name: 'Quiz 1',
  dueDate: 'Thursday, January 15, 2026, 11:59 PM',
  status: 'open',
  courseId: '143648',
  courseName: 'SC/MATH 1014 O - Applied Calculus II',
  courseCode: 'MATH1014',
  url: 'https://eclass.yorku.ca/mod/quiz/view.php?id=1',
  type: 'quiz',
};

const WEBASSIGN_COURSE: CengageDashboardCourse = {
  title: 'MATH 1014 O',
  courseId: '1226089',
  courseKey: 'WA-production-1607530',
  launchUrl:
    'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
  platform: 'webassign',
  confidence: 0.99,
};

describe('assignment normalization helpers', () => {
  it('normalizes eClass deadlines with parsed and unknown date metadata', () => {
    const parsed = normalizeEclassAssignment(ECLASS_DEADLINE);
    expect(parsed).toMatchObject({
      platform: 'eclass',
      sourceTool: 'get_deadlines',
      id: 'eclass-1',
      name: 'Quiz 1',
      courseCode: 'MATH1014',
      type: 'quiz',
      dateParseStatus: 'ok',
    });
    expect(parsed.dueDateIso).toContain('2026');

    const unknown = normalizeEclassAssignment({
      ...ECLASS_DEADLINE,
      id: 'eclass-unknown',
      dueDate: 'sometime after reading week',
    });
    expect(unknown.dueDateIso).toBeUndefined();
    expect(unknown.dateParseStatus).toBe('unknown');
  });

  it('normalizes WebAssign and non-WebAssign Cengage assignments', () => {
    const webassign = normalizeCengageAssignment(
      {
        id: 'wa-1',
        name: 'Homework A',
        dueDate: '2026-02-10 23:59',
        dueDateIso: '2026-02-10T23:59:00.000Z',
        status: 'Pending',
        score: '- / 10',
        courseId: 'active-course-id',
        courseTitle: 'MATH 1014 O - My Assignments',
        url: '/web/Student/Assignment-Responses/last?dep=wa-1',
        rawText: 'Homework A Due Date',
      },
      WEBASSIGN_COURSE
    );

    expect(webassign).toMatchObject({
      platform: 'webassign',
      sourceTool: 'get_cengage_assignments',
      assignmentId: 'wa-1',
      courseId: 'active-course-id',
      courseTitle: 'MATH 1014 O - My Assignments',
      dateParseStatus: 'ok',
    });

    const owlv2 = normalizeCengageAssignment(
      {
        name: 'OWL Reading',
        dueDate: 'unannounced',
        status: 'unknown',
      },
      {
        ...WEBASSIGN_COURSE,
        title: 'Winter 2026: CHEM 1100 Sec N',
        courseId: 'chem-1100',
        courseKey: 'E-KY652BRRTNJRY',
        platform: 'owlv2',
      }
    );

    expect(owlv2).toMatchObject({
      platform: 'cengage',
      courseId: 'chem-1100',
      courseTitle: 'Winter 2026: CHEM 1100 Sec N',
      dateParseStatus: 'unknown',
    });
  });

  it('filters assignments by upcoming, month, and range scopes', () => {
    const items: NormalizedAssignment[] = [
      {
        platform: 'eclass',
        sourceTool: 'get_deadlines',
        name: 'January item',
        dueDateIso: '2026-01-15T12:00:00.000Z',
      },
      {
        platform: 'webassign',
        sourceTool: 'get_cengage_assignments',
        name: 'February item',
        dueDateIso: '2026-02-20T12:00:00.000Z',
      },
      {
        platform: 'webassign',
        sourceTool: 'get_cengage_assignments',
        name: 'Unknown item',
        dueDate: 'not a real date',
        dateParseStatus: 'unknown',
      },
    ];

    expect(filterAssignmentsByScope(items, { scope: 'upcoming' })).toBe(items);
    expect(
      filterAssignmentsByScope(items, {
        scope: 'month',
        month: 1,
        year: 2026,
      }).map((item) => item.name)
    ).toEqual(['January item']);
    expect(
      filterAssignmentsByScope(items, {
        scope: 'range',
        from: '2026-02-19',
        to: '2026-02-21',
      }).map((item) => item.name)
    ).toEqual(['February item']);
    expect(filterAssignmentsByScope(items, { scope: 'range' })).toEqual(items);
  });

  it('sorts dated assignments before unknown dates, then platform and name', () => {
    const sorted = sortAssignments([
      {
        platform: 'webassign',
        sourceTool: 'get_cengage_assignments',
        name: 'Zeta',
      },
      {
        platform: 'webassign',
        sourceTool: 'get_cengage_assignments',
        name: 'Beta',
        dueDateIso: '2026-01-01T12:00:00.000Z',
      },
      {
        platform: 'eclass',
        sourceTool: 'get_deadlines',
        name: 'Alpha',
        dueDateIso: '2026-01-01T12:00:00.000Z',
      },
    ]);

    expect(sorted.map((item) => `${item.platform}:${item.name}`)).toEqual([
      'eclass:Alpha',
      'webassign:Beta',
      'webassign:Zeta',
    ]);
  });
});
