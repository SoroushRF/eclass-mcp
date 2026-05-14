import { describe, expect, it } from 'vitest';
import {
  assignmentMatchesById,
  mapAssignmentSelection,
  normalizeAssignmentStatus,
  normalizeComparableUrl,
  resolveAbsoluteUrl,
  resolveAssignmentSelection,
  type WebAssignAssignment,
} from '../src/scraper/cengage';

const ASSIGNMENTS: WebAssignAssignment[] = [
  {
    id: '38685833',
    name: 'Homework 1',
    dueDate: '2026-03-01 23:59',
    dueDateIso: '2026-03-01T23:59:00.000Z',
    status: 'Pending',
    score: '- / 10',
    url: '/web/Student/Assignment-Responses/last?dep=38685833',
  },
  {
    id: '38685834',
    name: 'Homework 1',
    dueDate: '2026-03-02 23:59',
    status: 'Submitted',
    url: '/assignment/38685834',
  },
  {
    id: 'quiz-1',
    name: 'Quiz on derivatives',
    dueDate: '2026-03-03 23:59',
    status: 'Graded',
    url: '/take?assignmentId=quiz-1',
  },
];

describe('Cengage assignment selection utilities', () => {
  it('normalizes assignment statuses and maps public selection rows', () => {
    expect(normalizeAssignmentStatus(undefined)).toBe('unknown');
    expect(normalizeAssignmentStatus('Work submitted for grading')).toBe(
      'submitted'
    );
    expect(normalizeAssignmentStatus('GRADED late')).toBe('graded');
    expect(normalizeAssignmentStatus('Pending Extension')).toBe('pending');
    expect(normalizeAssignmentStatus('In progress')).toBe('unknown');

    expect(mapAssignmentSelection(ASSIGNMENTS[0])).toEqual({
      assignmentId: '38685833',
      name: 'Homework 1',
      dueDate: '2026-03-01 23:59',
      dueDateIso: '2026-03-01T23:59:00.000Z',
      status: 'pending',
      score: '- / 10',
      url: '/web/Student/Assignment-Responses/last?dep=38685833',
    });
  });

  it('normalizes and resolves assignment URLs defensively', () => {
    expect(
      normalizeComparableUrl(
        '/web/Student/Assignment-Responses/last?dep=38685833#answer',
        'https://www.webassign.net/root'
      )
    ).toBe(
      'www.webassign.net/web/student/assignment-responses/last?dep=38685833'
    );
    expect(normalizeComparableUrl('not a url')).toBe('not a url');
    expect(normalizeComparableUrl('')).toBe('');
    expect(
      resolveAbsoluteUrl('/take?assignmentId=quiz-1', 'https://host/base')
    ).toBe('https://host/take?assignmentId=quiz-1');
    expect(resolveAbsoluteUrl(undefined, 'https://host/base')).toBe('');
    expect(resolveAbsoluteUrl('http://[bad', 'https://host/base')).toBe('');
  });

  it('matches assignment ids from direct ids and common WebAssign URL tokens', () => {
    expect(assignmentMatchesById(ASSIGNMENTS[0], '38685833')).toBe(true);
    expect(assignmentMatchesById(ASSIGNMENTS[0], 'missing')).toBe(false);
    expect(
      assignmentMatchesById(
        { ...ASSIGNMENTS[0], id: undefined, url: '/last?dep=38685833' },
        '38685833'
      )
    ).toBe(true);
    expect(
      assignmentMatchesById(
        { ...ASSIGNMENTS[0], id: undefined, url: '/assignment/38685834' },
        '38685834'
      )
    ).toBe(true);
    expect(
      assignmentMatchesById(
        { ...ASSIGNMENTS[0], id: undefined, url: '/take?assignmentId=quiz-1' },
        'quiz-1'
      )
    ).toBe(true);
    expect(
      assignmentMatchesById(
        { ...ASSIGNMENTS[0], id: undefined, url: undefined },
        ''
      )
    ).toBe(false);
    expect(
      assignmentMatchesById(
        { ...ASSIGNMENTS[0], id: undefined, url: undefined },
        'x'
      )
    ).toBe(false);
  });

  it('resolves assignment selection by URL, id, query, or default order', () => {
    const baseUrl = 'https://www.webassign.net/web/Student/Home.html';

    expect(
      resolveAssignmentSelection({ assignments: [], baseUrl }).message
    ).toContain('No assignments were available');

    expect(
      resolveAssignmentSelection({
        assignments: ASSIGNMENTS,
        baseUrl,
        assignmentUrl:
          'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=38685833',
      }).selected?.id
    ).toBe('38685833');
    expect(
      resolveAssignmentSelection({
        assignments: ASSIGNMENTS,
        baseUrl,
        assignmentUrl: 'https://www.webassign.net/missing',
      }).message
    ).toContain('No assignment matched assignmentUrl');

    expect(
      resolveAssignmentSelection({
        assignments: ASSIGNMENTS,
        baseUrl,
        assignmentId: 'quiz-1',
      }).selected?.id
    ).toBe('quiz-1');
    expect(
      resolveAssignmentSelection({
        assignments: ASSIGNMENTS,
        baseUrl,
        assignmentId: 'nope',
      }).message
    ).toContain('No assignment matched assignmentId');

    expect(
      resolveAssignmentSelection({
        assignments: [ASSIGNMENTS[2]],
        baseUrl,
        assignmentQuery: 'Quiz on derivatives',
      }).selected?.id
    ).toBe('quiz-1');

    const exactDuplicate = resolveAssignmentSelection({
      assignments: ASSIGNMENTS,
      baseUrl,
      assignmentQuery: 'Homework 1',
    });
    expect(exactDuplicate.selected?.id).toBe('38685833');
    expect(exactDuplicate.message).toContain('Multiple assignments matched');

    expect(
      resolveAssignmentSelection({
        assignments: ASSIGNMENTS,
        baseUrl,
        assignmentQuery: 'derivatives',
      }).selected?.id
    ).toBe('quiz-1');

    const partialDuplicate = resolveAssignmentSelection({
      assignments: ASSIGNMENTS,
      baseUrl,
      assignmentQuery: 'homework',
    });
    expect(partialDuplicate.selected?.id).toBe('38685833');
    expect(partialDuplicate.message).toContain('first partial match');

    expect(
      resolveAssignmentSelection({
        assignments: ASSIGNMENTS,
        baseUrl,
        assignmentQuery: 'integrals',
      }).message
    ).toContain('No assignment matched assignmentQuery');

    const fallback = resolveAssignmentSelection({
      assignments: ASSIGNMENTS,
      baseUrl,
    });
    expect(fallback.selected?.id).toBe('38685833');
    expect(fallback.message).toContain('Defaulted to the first assignment');
  });
});
