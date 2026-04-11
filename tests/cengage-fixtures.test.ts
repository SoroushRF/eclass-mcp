import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseWebAssignAssignments } from '../src/scraper/cengage-assignment-parser';
import {
  extractDashboardCourses,
  extractDashboardCoursesFromCardCandidates,
} from '../src/scraper/cengage-courses';
import {
  classifyCengagePageState,
  type CengagePageStateSignals,
} from '../src/scraper/cengage-state';
import { normalizeAndClassifyCengageEntry } from '../src/scraper/cengage-url';

const CENGAGE_FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'cengage');

function readFixtureJson<T>(name: string): T {
  const fixturePath = path.join(CENGAGE_FIXTURE_DIR, name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as T;
}

function stable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('cengage fixture snapshots', () => {
  it('matches URL classifier fixture snapshot', () => {
    const cases = readFixtureJson<Array<{ id: string; input: string }>>(
      'url-classifier-cases.json'
    );
    const expected = readFixtureJson<
      Array<{
        id: string;
        linkType: string;
        host: string;
        normalizedUrl: string;
      }>
    >('url-classifier.snapshot.json');

    const actual = cases.map((entry) => {
      const parsed = normalizeAndClassifyCengageEntry(entry.input);
      return {
        id: entry.id,
        linkType: parsed.linkType,
        host: parsed.host,
        normalizedUrl: parsed.normalizedUrl,
      };
    });

    expect(actual).toStrictEqual(expected);
  });

  it('matches dashboard course extraction fixture snapshot', () => {
    const candidates = readFixtureJson<
      Array<{
        href: string;
        text?: string;
        titleAttr?: string;
        ariaLabel?: string;
        dataCourseId?: string;
        dataCourseKey?: string;
      }>
    >('dashboard-link-candidates.dashboard.json');

    const expected = readFixtureJson<
      Array<{
        title: string;
        launchUrl: string;
        platform: 'webassign' | 'cengage';
        confidence: number;
        courseId?: string;
        courseKey?: string;
      }>
    >('dashboard-courses.dashboard.snapshot.json');

    const actual = stable(
      extractDashboardCourses(
        candidates,
        'https://www.cengage.com/dashboard/home'
      )
    );

    expect(actual).toStrictEqual(expected);
  });

  it('matches dashboard card extraction fixture snapshot', () => {
    const cardCandidates = readFixtureJson<
      Array<{
        cardId?: string;
        cardTitle?: string;
        launchHref: string;
        launchText?: string;
        launchTitleAttr?: string;
        launchAriaLabel?: string;
        dataCourseId?: string;
        dataCourseKey?: string;
      }>
    >('dashboard-card-candidates.dashboard.json');

    const expected = readFixtureJson<
      Array<{
        title: string;
        launchUrl: string;
        platform: 'webassign' | 'cengage';
        confidence: number;
        courseId?: string;
        courseKey?: string;
      }>
    >('dashboard-courses.cards.snapshot.json');

    const actual = stable(
      extractDashboardCoursesFromCardCandidates(
        cardCandidates,
        'https://www.cengage.ca/dashboard/home'
      )
    );

    expect(actual).toStrictEqual(expected);
  });

  it('matches page-state fixture snapshot across login/dashboard/course variants', () => {
    const cases = readFixtureJson<
      Array<{ id: string; signals: CengagePageStateSignals }>
    >('page-state-signals.json');

    const expected = readFixtureJson<
      Array<{
        id: string;
        state: string;
        reason: string;
        markers: {
          hasLoginUrl: boolean;
          hasDashboardUrl: boolean;
          hasWebassignStudentUrl: boolean;
          hasWebassignLoginWithCourseKey: boolean;
        };
      }>
    >('page-state.snapshot.json');

    const actual = cases.map((entry) => {
      const result = classifyCengagePageState(entry.signals);
      return {
        id: entry.id,
        state: result.state,
        reason: result.reason,
        markers: {
          hasLoginUrl: result.diagnostics.markers.hasLoginUrl,
          hasDashboardUrl: result.diagnostics.markers.hasDashboardUrl,
          hasWebassignStudentUrl:
            result.diagnostics.markers.hasWebassignStudentUrl,
          hasWebassignLoginWithCourseKey:
            result.diagnostics.markers.hasWebassignLoginWithCourseKey,
        },
      };
    });

    expect(actual).toStrictEqual(expected);
  });

  it('matches assignment parser snapshot for React-style rows', () => {
    const rows = readFixtureJson<
      Array<{
        id?: string;
        href?: string;
        name?: string;
        dueDate?: string;
        score?: string;
        statusHint?: string;
        courseId?: string;
        courseKey?: string;
        courseTitle?: string;
        rowText: string;
      }>
    >('assignment-rows.react.json');

    const expected = readFixtureJson<
      Array<{
        id?: string;
        name: string;
        dueDate: string;
        dueDateIso?: string;
        dueDateRaw?: string;
        score?: string;
        status: string;
        courseId?: string;
        courseTitle?: string;
        url?: string;
        rawText: string;
      }>
    >('assignment-parser.react.snapshot.json');

    const actual = stable(
      parseWebAssignAssignments(rows, {
        courseId: 'math-1010',
        courseTitle: 'MATH 1010 - Calculus I',
      })
    );

    expect(actual).toStrictEqual(expected);
  });

  it('matches assignment parser snapshot for table-like rows', () => {
    const rows = readFixtureJson<
      Array<{
        id?: string;
        href?: string;
        name?: string;
        dueDate?: string;
        score?: string;
        statusHint?: string;
        courseId?: string;
        courseKey?: string;
        courseTitle?: string;
        rowText: string;
      }>
    >('assignment-rows.table.json');

    const expected = readFixtureJson<
      Array<{
        id?: string;
        name: string;
        dueDate: string;
        dueDateIso?: string;
        dueDateRaw?: string;
        score?: string;
        status: string;
        courseId?: string;
        courseTitle?: string;
        url?: string;
        rawText: string;
      }>
    >('assignment-parser.table.snapshot.json');

    const actual = stable(parseWebAssignAssignments(rows));

    expect(actual).toStrictEqual(expected);
  });
});

describe('cengage brittle-pattern regressions', () => {
  it('keeps Pending status when row includes not-submitted and score text', () => {
    const parsed = parseWebAssignAssignments([
      {
        id: 'asg-reg-1',
        name: 'Practice Set',
        dueDate: '03/11/2026 11:59 PM',
        score: '0/10',
        statusHint: 'Not Submitted',
        rowText:
          'Practice Set Due Date 03/11/2026 11:59 PM Not Submitted Score 0/10',
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe('Pending');
  });

  it('classifies assignment state over login markers when WebAssign student URL has due-date signals', () => {
    const result = classifyCengagePageState({
      url: 'https://www.webassign.net/web/Student/Home.html',
      hasDueDateText: true,
      hasPasswordInput: true,
      hasLoginButton: true,
    });

    expect(result.state).toBe('assignments');
  });
});
