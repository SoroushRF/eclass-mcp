import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseWebAssignAssignments } from '../src/scraper/cengage-assignment-parser';
import {
  assignmentMatchesById,
  mapAssignmentSelection,
  normalizeAssignmentStatus,
  normalizeComparableText,
  normalizeComparableUrl,
  resolveAbsoluteUrl,
  resolveAssignmentSelection,
  type WebAssignAssignment,
} from '../src/scraper/cengage';

const CENGAGE_FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'cengage');

function readFixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(CENGAGE_FIXTURE_DIR, name), 'utf-8')
  ) as T;
}

function fixtureAssignments(): WebAssignAssignment[] {
  const fixture = readFixture<{
    courses: Array<{
      courseId: string;
      courseTitle: string;
      rows: Array<Record<string, string>>;
    }>;
  }>('dashboard-assignment-rows.multi-course.json');

  const firstCourse = fixture.courses[0];
  return parseWebAssignAssignments(firstCourse.rows as any, {
    courseId: firstCourse.courseId,
    courseTitle: firstCourse.courseTitle,
  }) as WebAssignAssignment[];
}

describe('cengage selection helpers', () => {
  it('normalizes comparable text and assignment status labels', () => {
    expect(normalizeComparableText('  Homework   1  ')).toBe('homework 1');

    expect(normalizeAssignmentStatus('Pending review')).toBe('pending');
    expect(normalizeAssignmentStatus('Submitted attempt')).toBe('submitted');
    expect(normalizeAssignmentStatus('Graded')).toBe('graded');
    expect(normalizeAssignmentStatus('')).toBe('unknown');
    expect(normalizeAssignmentStatus(undefined)).toBe('unknown');
  });

  it('normalizes and resolves URLs for assignment comparison', () => {
    expect(
      normalizeComparableUrl('/assignment/5011#top', 'https://www.webassign.net')
    ).toBe('www.webassign.net/assignment/5011');

    expect(
      normalizeComparableUrl(
        'https://www.webassign.net/assignment/5011?view=full',
        'https://www.webassign.net'
      )
    ).toBe('www.webassign.net/assignment/5011?view=full');

    expect(normalizeComparableUrl('not a url')).toBe('not a url');

    expect(resolveAbsoluteUrl('/assignment/5011', 'https://www.webassign.net')).toBe(
      'https://www.webassign.net/assignment/5011'
    );
    expect(resolveAbsoluteUrl('http://[::1', 'https://www.webassign.net')).toBe(
      ''
    );
  });

  it('matches assignments by id or URL token hints', () => {
    const assignment: WebAssignAssignment = {
      name: 'Homework 1',
      dueDate: '2026-04-12 23:59',
      status: 'submitted',
      id: 'asg-5011',
      url: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=39248944',
    };

    expect(assignmentMatchesById(assignment, 'asg-5011')).toBe(true);
    expect(assignmentMatchesById(assignment, '39248944')).toBe(true);
    expect(assignmentMatchesById(assignment, '')).toBe(false);
    expect(assignmentMatchesById(assignment, 'missing')).toBe(false);
  });

  it('maps assignment selection payload with normalized status', () => {
    const mapped = mapAssignmentSelection({
      name: 'Lab 1',
      dueDate: '2026-04-15 17:00',
      status: 'Graded',
      id: 'asg-6011',
      score: '10/10',
      url: '/assignment/6011',
    });

    expect(mapped).toEqual({
      assignmentId: 'asg-6011',
      name: 'Lab 1',
      dueDate: '2026-04-15 17:00',
      dueDateIso: undefined,
      status: 'graded',
      score: '10/10',
      url: '/assignment/6011',
    });
  });

  it('resolves assignment selection by URL, id, query, and fallback', () => {
    const assignments = fixtureAssignments();
    const baseUrl = 'https://www.webassign.net/web/Student/Home.html';

    const byUrl = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentUrl: '/assignment/5011',
    });
    expect(byUrl.selected?.id).toBe('asg-5011');

    const byId = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentId: 'asg-5012',
    });
    expect(byId.selected?.id).toBe('asg-5012');

    const byExactQuery = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentQuery: 'Homework 1',
    });
    expect(byExactQuery.selected?.name).toBe('Homework 1');

    const partialQuery = (assignments[1]?.name || '').split(' ')[0];
    const byPartialQuery = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentQuery: partialQuery,
    });
    expect(byPartialQuery.selected?.id).toBe(assignments[1]?.id);

    const fallback = resolveAssignmentSelection({
      assignments,
      baseUrl,
    });
    expect(fallback.selected?.name).toBe(assignments[0].name);
    expect(fallback.message).toContain('Defaulted to the first assignment');
  });

  it('returns messages for no-match and multi-match cases', () => {
    const baseUrl = 'https://www.webassign.net/web/Student/Home.html';
    const assignments: WebAssignAssignment[] = [
      {
        name: 'Homework 1',
        dueDate: '2026-04-12 23:59',
        status: 'Submitted',
        id: 'asg-1',
        url: '/assignment/1',
      },
      {
        name: 'Homework 1',
        dueDate: '2026-04-13 23:59',
        status: 'Pending',
        id: 'asg-2',
        url: '/assignment/2',
      },
      {
        name: 'Homework 2',
        dueDate: '2026-04-14 23:59',
        status: 'Pending',
        id: 'asg-3',
        url: '/assignment/3',
      },
    ];

    const noAssignments = resolveAssignmentSelection({
      assignments: [],
      baseUrl,
      assignmentQuery: 'anything',
    });
    expect(noAssignments.selected).toBeUndefined();
    expect(noAssignments.message).toContain('No assignments were available');

    const noUrlMatch = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentUrl: '/missing',
    });
    expect(noUrlMatch.selected).toBeUndefined();
    expect(noUrlMatch.message).toContain('No assignment matched assignmentUrl');

    const noIdMatch = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentId: 'missing-id',
    });
    expect(noIdMatch.selected).toBeUndefined();
    expect(noIdMatch.message).toContain('No assignment matched assignmentId');

    const multiExact = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentQuery: 'Homework 1',
    });
    expect(multiExact.selected?.id).toBe('asg-1');
    expect(multiExact.message).toContain('exactly');

    const multiPartial = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentQuery: 'homework',
    });
    expect(multiPartial.selected?.id).toBe('asg-1');
    expect(multiPartial.message).toContain('partial match');

    const noQueryMatch = resolveAssignmentSelection({
      assignments,
      baseUrl,
      assignmentQuery: 'final project',
    });
    expect(noQueryMatch.selected).toBeUndefined();
    expect(noQueryMatch.message).toContain('No assignment matched assignmentQuery');
  });
});
