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
      dueDate: 'Feb 12, 2026 11:59 PM',
      status: 'Graded',
      score: '9/10',
    });
  });

  it('parses table-style rows and infers due date from row text', () => {
    const rows: CengageAssignmentRowCandidate[] = [
      {
        name: 'Quiz 2',
        rowText:
          'Quiz 2 Assignment Due Date Mar 03, 2026 Not Submitted',
      },
    ];

    const assignments = parseWebAssignAssignments(rows);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].name).toBe('Quiz 2');
    expect(assignments[0].dueDate).toBe('Mar 03, 2026');
    expect(assignments[0].status).toBe('Pending');
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
        rowText:
          'Lab 3 - Electric Fields Due Date Apr 10, 2026 Submitted',
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

describe('cengage parser selector guards', () => {
  it('includes stable assignment-container selectors and avoids global roots', () => {
    expect(ASSIGNMENT_CONTAINER_SELECTORS).toContain(
      '#js-student-myAssignmentsWrapper'
    );
    expect(ASSIGNMENT_CONTAINER_SELECTORS).toContain('[id*="myAssignments"]');
    expect(ASSIGNMENT_CONTAINER_SELECTORS).not.toContain('body');
    expect(ASSIGNMENT_CONTAINER_SELECTORS).not.toContain('html');
  });

  it('contains assignment-focused row selectors', () => {
    expect(ASSIGNMENT_ROW_SELECTORS).toContain('[data-assignment-id]');
    expect(ASSIGNMENT_ROW_SELECTORS).toContain('li[class*="assignment"]');
    expect(ASSIGNMENT_ROW_SELECTORS).toContain('tr[class*="assignment"]');
  });
});