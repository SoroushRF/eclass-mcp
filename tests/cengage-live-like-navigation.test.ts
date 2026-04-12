import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { parseWebAssignAssignments } from '../src/scraper/cengage-assignment-parser';
import {
  resolveDashboardCourseSelection,
  type CengageDashboardCourse,
} from '../src/scraper/cengage-courses';
import {
  waitForCengagePageState,
  type CengagePageState,
  type CengagePageStateSignals,
} from '../src/scraper/cengage-state';

const CENGAGE_FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'cengage');

function readFixtureJson<T>(name: string): T {
  const fixturePath = path.join(CENGAGE_FIXTURE_DIR, name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as T;
}

describe('cengage live-like navigation semantics', () => {
  it('tracks student-home transition path and settles on assignments state', async () => {
    const fixture = readFixtureJson<{
      sequence: CengagePageStateSignals[];
      expectedTransitionStates: CengagePageState[];
      expectedFinalState: CengagePageState;
    }>('state-transitions.student-home.json');

    let index = 0;
    const page = {
      evaluate: vi.fn().mockImplementation(() => {
        const current =
          fixture.sequence[Math.min(index, fixture.sequence.length - 1)];
        index += 1;

        return {
          title: current.title || '',
          bodyTextSnippet: current.bodyTextSnippet || '',
          hasPasswordInput: !!current.hasPasswordInput,
          hasLoginButton: !!current.hasLoginButton,
          hasAssignmentsWrapper: !!current.hasAssignmentsWrapper,
          hasDueDateText: !!current.hasDueDateText,
          hasPastAssignmentsButton: !!current.hasPastAssignmentsButton,
          hasCourseLinks: !!current.hasCourseLinks,
          hasInterstitialText: !!current.hasInterstitialText,
        };
      }),
      url: vi.fn().mockImplementation(() => {
        const current = fixture.sequence[Math.max(0, index - 1)];
        return current.url;
      }),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await waitForCengagePageState(page, {
      timeoutMs: 3000,
      pollIntervalMs: 1,
      stableReadings: 1,
      acceptableStates: ['assignments'],
    });

    expect(result.state).toBe(fixture.expectedFinalState);
    expect(
      result.diagnostics.transitionPath?.map((entry) => entry.state)
    ).toEqual(fixture.expectedTransitionStates);
  });

  it('keeps ambiguous course selection deterministic for near-duplicate titles', () => {
    const fixture = readFixtureJson<{
      query: string;
      courses: CengageDashboardCourse[];
      expectedStatus: 'ambiguous';
      expectedCandidateTitles: string[];
    }>('course-selection.ambiguous.json');

    const result = resolveDashboardCourseSelection(fixture.courses, {
      courseQuery: fixture.query,
    });

    expect(result.status).toBe(fixture.expectedStatus);
    expect(result.candidates.map((course) => course.title)).toEqual(
      fixture.expectedCandidateTitles
    );
  });

  it('parses dashboard-first assignment rows from multiple courses with preserved course metadata', () => {
    const fixture = readFixtureJson<{
      courses: Array<{
        courseId: string;
        courseTitle: string;
        rows: Array<{
          id?: string;
          href?: string;
          name?: string;
          dueDate?: string;
          score?: string;
          statusHint?: string;
          rowText: string;
        }>;
      }>;
      expectedTotalAssignments: number;
    }>('dashboard-assignment-rows.multi-course.json');

    const parsed = fixture.courses.flatMap((course) =>
      parseWebAssignAssignments(course.rows, {
        courseId: course.courseId,
        courseTitle: course.courseTitle,
      })
    );

    expect(parsed).toHaveLength(fixture.expectedTotalAssignments);
    expect(parsed.every((item) => !!item.courseId && !!item.courseTitle)).toBe(
      true
    );
    expect(parsed.some((item) => item.status === 'Pending')).toBe(true);
    expect(parsed.some((item) => item.status === 'Submitted')).toBe(true);
    expect(parsed.some((item) => item.status === 'Graded')).toBe(true);
  });
});
