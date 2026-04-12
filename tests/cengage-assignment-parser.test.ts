import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_CONTAINER_SELECTORS,
  ASSIGNMENT_ROW_SELECTORS,
  parseWebAssignAssignments,
  type CengageAssignmentRowCandidate,
} from '../src/scraper/cengage-assignment-parser';

describe('cengage assignment parser v1', () => {
  it('parses React-style assignment rows with explicit attributes', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        id: 'asg-1001',
        href: '/assignment/1001',
        name: 'Chapter 1 Homework',
        dueDate: 'Feb 12, 2026 11:59 PM',
        statusHint: 'Submitted',
        score: '9/10',
        rowText:
          'Chapter 1 Homework Due Date Feb 12, 2026 11:59 PM Submitted Score 9/10',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toEqual({
      id: 'asg-1001',
      name: 'Chapter 1 Homework',
      dueDate: '2026-02-12 23:59',
      dueDateIso: '2026-02-12T23:59:00',
      dueDateRaw: 'Feb 12, 2026 11:59 PM',
      status: 'Graded',
      score: '9/10',
      url: '/assignment/1001',
      rawText:
        'Chapter 1 Homework Due Date Feb 12, 2026 11:59 PM Submitted Score 9/10',
    });
  });

  it('parses table-style rows and infers due date from row text', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        name: 'Quiz 2',
        rowText: 'Quiz 2 Assignment Due Date Mar 03, 2026 Not Submitted',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].name).toBe('Quiz 2');
    expect(assignments[0].dueDate).toBe('2026-03-03');
    expect(assignments[0].dueDateIso).toBe('2026-03-03T00:00:00');
    expect(assignments[0].dueDateRaw).toBe('Mar 03, 2026');
    expect(assignments[0].status).toBe('Pending');
  });

  it('parses numeric slash date formats and normalizes to ISO-friendly strings', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        id: 'asg-3003',
        name: 'Unit Test 3',
        dueDate: '03/28/2026 11:30 PM',
        rowText: 'Unit Test 3 Due 03/28/2026 11:30 PM',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].dueDate).toBe('2026-03-28 23:30');
    expect(assignments[0].dueDateIso).toBe('2026-03-28T23:30:00');
    expect(assignments[0].dueDateRaw).toBe('03/28/2026 11:30 PM');
  });

  it('keeps unknown status instead of defaulting to submitted/pending when no status signal exists', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        id: 'asg-3004',
        name: 'Reading Reflection',
        dueDate: '2026-04-12',
        rowText: 'Reading Reflection Due Date 2026-04-12',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].status).toBe('Unknown');
    expect(assignments[0].dueDate).toBe('2026-04-12');
    expect(assignments[0].dueDateIso).toBe('2026-04-12T00:00:00');
  });

  it('normalizes assignment names that inline due-date text', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        id: 'asg-3005',
        name: 'Assignment 10, Due Date: April 3 (11:59PM)',
        dueDate: 'Friday, April 3, 2026 at 11:59 PM EDT',
        rowText:
          'Assignment 10, Due Date: April 3 (11:59PM) Friday, April 3, 2026 at 11:59 PM EDT',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].name).toBe('Assignment 10');
    expect(assignments[0].dueDate).toBe('2026-04-03 23:59');
  });

  it('ignores assignment tab/header labels captured as row-like candidates', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        name: 'Current Assignments',
        rowText: 'Current Assignments',
      },
      {
        name: 'Past Assignments',
        rowText: 'Past Assignments',
      },
      {
        name: 'All Assignments',
        rowText: 'All Assignments',
      },
      {
        name: 'Past AssignmentsRestrictions',
        rowText: 'Past Assignments Restrictions Due Date Score',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(0);
  });

  it('dedupes duplicate rows by assignment id and keeps richer candidate', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        id: 'asg-2002',
        name: 'Lab 3',
        rowText: 'Lab 3 Due Date Apr 10, 2026',
      },
      {
        id: 'asg-2002',
        name: 'Lab 3 - Electric Fields',
        dueDate: 'Apr 10, 2026',
        statusHint: 'Submitted',
        rowText: 'Lab 3 - Electric Fields Due Date Apr 10, 2026 Submitted',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].name).toBe('Lab 3 - Electric Fields');
    expect(assignments[0].status).toBe('Submitted');
  });

  it('ignores rows that are missing assignment names', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        rowText: 'Due Date Apr 15, 2026',
      },
      {
        name: 'Unknown Assignment',
        rowText: 'Unknown Assignment Due Date Apr 15, 2026',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(0);
  });
});

describe('cengage assignment dedupe identity', () => {
  it('does not collapse rows with same assignment id across different courses', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        id: 'asg-5001',
        courseId: 'math-1010',
        name: 'Weekly Quiz',
        dueDate: 'Apr 20, 2026',
        rowText: 'Weekly Quiz Due Date Apr 20, 2026 Submitted',
      },
      {
        id: 'asg-5001',
        courseId: 'phys-1420',
        name: 'Weekly Quiz',
        dueDate: 'Apr 20, 2026',
        rowText: 'Weekly Quiz Due Date Apr 20, 2026 Submitted',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(2);

    const courseIds = assignments.map((item) => item.courseId).sort();
    expect(courseIds).toEqual(['math-1010', 'phys-1420']);
  });

  it('dedupes by href-derived assignment id inside one course scope', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        href: '/assignment/view/7777?attempt=1',
        name: 'Practice Set 7',
        dueDate: '2026-04-25',
        rowText: 'Practice Set 7 Due Date 2026-04-25',
      },
      {
        href: '/assignment/view/7777?attempt=2',
        name: 'Practice Set 7',
        dueDate: '2026-04-25',
        rowText: 'Practice Set 7 Due Date 2026-04-25 Submitted',
      },
    ];

    const assignments = parseWebAssignAssignments(rows, {
      courseId: 'math-2010',
      courseTitle: 'MATH 2010 - Calculus II',
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0].courseId).toBe('math-2010');
    expect(assignments[0].courseTitle).toBe('MATH 2010 - Calculus II');
  });

  it('uses normalized title+due fallback key when no id/href exists', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        name: 'Lab #8: Newtons Law',
        dueDate: 'May 01, 2026',
        rowText: 'Lab #8: Newtons Law Due Date May 01, 2026',
      },
      {
        name: 'Lab 8 Newtons Law',
        dueDate: 'May 01, 2026',
        rowText: 'Lab 8 Newtons Law Due Date May 01, 2026 Submitted',
      },
    ];

    const assignments = parseWebAssignAssignments(rows, {
      courseKey: 'WA-production-8888',
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0].name).toBe('Lab #8: Newtons Law');
  });
});

describe('cengage parser selector guards', () => {
  it('includes stable assignment-container selectors and avoids global roots', () => {
    expect(ASSIGNMENT_CONTAINER_SELECTORS).toContain(
      '#js-student-myAssignmentsWrapper'
    );
    expect(ASSIGNMENT_CONTAINER_SELECTORS).toContain(
      '#js-student-myAssignmentsPage'
    );
    expect(ASSIGNMENT_CONTAINER_SELECTORS).toContain('[id*="myAssignments"]');
    expect(ASSIGNMENT_CONTAINER_SELECTORS).toContain(
      '[data-test="pastAssignmentContainer"]'
    );
    expect(ASSIGNMENT_CONTAINER_SELECTORS).not.toContain('body');
    expect(ASSIGNMENT_CONTAINER_SELECTORS).not.toContain('html');
  });

  it('contains assignment-focused row selectors', () => {
    expect(ASSIGNMENT_ROW_SELECTORS).toContain('[data-assignment-id]');
    expect(ASSIGNMENT_ROW_SELECTORS).toContain('tr[data-test^="assignment_"]');
    expect(ASSIGNMENT_ROW_SELECTORS).toContain('li[class*="assignment"]');
    expect(ASSIGNMENT_ROW_SELECTORS).toContain('tr[class*="assignment"]');
  });
});
