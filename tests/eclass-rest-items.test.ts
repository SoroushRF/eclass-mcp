import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EclassScraperDependency } from '../src/tools/dependencies';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import {
  EclassHybridProvider,
  itemViewCmid,
  type RestReader,
} from '../src/scraper/eclass/api/hybrid';
import {
  formatMoodleDate,
  mapRestAssignmentDetails,
  mapRestQuizDetails,
} from '../src/scraper/eclass/api/rest-items';
import {
  MoodleRestAssignmentsDataSchema,
  MoodleRestQuizzesDataSchema,
  MoodleRestSubmissionStatusSchema,
} from '../src/scraper/eclass/api/types';
import { rootLogger } from '../src/logging/logger';

const ORIGIN = 'https://eclass.yorku.ca';
const ASSIGN_URL = `${ORIGIN}/mod/assign/view.php?id=12`;
const QUIZ_URL = `${ORIGIN}/mod/quiz/view.php?id=40`;
const WS_FILE = `${ORIGIN}/webservice/pluginfile.php/9/mod_assign/introattachment/0/spec.pdf`;
// 2026-01-01T04:59:00Z, 23:59 in Toronto.
const DUE = 1767243540;

afterEach(() => {
  vi.restoreAllMocks();
});

function assignments() {
  return MoodleRestAssignmentsDataSchema.parse({
    courses: [
      {
        id: 101,
        assignments: [
          {
            id: 301,
            cmid: 12,
            name: 'Lab 1',
            duedate: DUE,
            allowsubmissionsfromdate: 0,
            intro: `<p>Read the <a href="https://example.com/guide">guide</a>.</p><img src="${ORIGIN}/webservice/pluginfile.php/9/mod_assign/intro/fig.png">`,
            introfiles: [
              {
                filename: 'fig.png',
                fileurl: `${ORIGIN}/webservice/pluginfile.php/9/mod_assign/intro/fig.png`,
              },
            ],
            introattachments: [{ filename: 'spec.pdf', fileurl: WS_FILE }],
          },
        ],
      },
    ],
  });
}

function submittedStatus() {
  return MoodleRestSubmissionStatusSchema.parse({
    lastattempt: {
      submission: {
        status: 'submitted',
        timemodified: DUE - 3600,
        plugins: [
          {
            type: 'file',
            fileareas: [
              {
                area: 'submission_files',
                files: [
                  {
                    filename: 'lab1.zip',
                    fileurl: `${ORIGIN}/webservice/pluginfile.php/9/assignsubmission_file/submission_files/5/lab1.zip`,
                  },
                ],
              },
            ],
          },
        ],
      },
      gradingstatus: 'graded',
    },
    feedback: {
      gradefordisplay: '8.00&nbsp;/&nbsp;10.00',
      plugins: [
        {
          type: 'comments',
          editorfields: [{ name: 'comments', text: '<p>Nice work.</p>' }],
        },
      ],
    },
  });
}

function quizzes() {
  return MoodleRestQuizzesDataSchema.parse({
    quizzes: [
      {
        id: 70,
        coursemodule: 40,
        name: 'Quiz 1',
        intro: '<p>Covers week 1.</p>',
        timeopen: DUE - 86_400,
        timeclose: DUE,
        timelimit: 5400,
        attempts: 0,
        grade: 10,
        decimalpoints: 1,
        hasfeedback: 1,
      },
    ],
  });
}

describe('REST item detail mapping', () => {
  it('formats dates the way eClass shows them, in campus time', () => {
    expect(formatMoodleDate(DUE)).toBe('Wednesday, 31 December 2025, 11:59 PM');
    expect(formatMoodleDate(0)).toBe('');
  });

  it('maps an assignment with status, files, grade and feedback', () => {
    const [assignment] = assignments().courses[0]!.assignments;
    const details = mapRestAssignmentDetails({
      url: ASSIGN_URL,
      courseId: '101',
      assignment: assignment!,
      status: submittedStatus(),
    });

    expect(details).toMatchObject({
      kind: 'assign',
      courseId: '101',
      title: 'Lab 1',
      descriptionText: 'Read the guide.',
      descriptionImageUrls: [
        `${ORIGIN}/pluginfile.php/9/mod_assign/intro/fig.png`,
      ],
      externalLinks: [
        { name: 'guide', url: 'https://example.com/guide', linkType: 'other' },
      ],
      grade: '8.00 / 10.00',
      feedbackText: 'Nice work.',
      fields: {
        'Due date': 'Wednesday, 31 December 2025, 11:59 PM',
        'Submission status': 'Submitted for grading',
        'Grading status': 'Graded',
        'Last modified': 'Wednesday, 31 December 2025, 10:59 PM',
        'File submissions': 'lab1.zip',
        Grade: '8.00 / 10.00',
        'Feedback comments': 'Nice work.',
      },
    });
    expect(details.fields).not.toHaveProperty('Opened');
    expect(details.descriptionHtml).not.toContain('/webservice/');
    // The embedded image is a description image, not an attachment.
    expect(details.attachments?.map((a) => [a.kind, a.name, a.url])).toEqual([
      [
        'pdf',
        'spec.pdf',
        `${ORIGIN}/pluginfile.php/9/mod_assign/introattachment/0/spec.pdf`,
      ],
      [
        'other',
        'lab1.zip',
        `${ORIGIN}/pluginfile.php/9/assignsubmission_file/submission_files/5/lab1.zip`,
      ],
    ]);
  });

  it('reports an unreadable status as unknown and skips the empty record date', () => {
    const [assignment] = assignments().courses[0]!.assignments;
    const unknown = mapRestAssignmentDetails({
      url: ASSIGN_URL,
      courseId: '101',
      assignment: assignment!,
      status: null,
    });
    expect(unknown.fields?.['Submission status']).toBe(
      'Unknown (status unavailable)'
    );
    expect(unknown.grade).toBeUndefined();

    const fresh = mapRestAssignmentDetails({
      url: ASSIGN_URL,
      courseId: '101',
      assignment: assignment!,
      status: MoodleRestSubmissionStatusSchema.parse({
        lastattempt: {
          submission: { status: 'new', timemodified: DUE },
          extensionduedate: DUE + 86_400,
        },
      }),
    });
    expect(fresh.fields).not.toHaveProperty('Last modified');
    expect(fresh.fields?.['Due date']).toBe(
      'Thursday, 1 January 2026, 11:59 PM (extension granted)'
    );
  });

  it('maps a quiz with limits, best grade and feedback', () => {
    const details = mapRestQuizDetails({
      url: QUIZ_URL,
      courseId: '101',
      quiz: quizzes().quizzes[0]!,
      bestGrade: { hasgrade: true, grade: 7.5 },
      attempts: { attempts: [{ id: 1, state: 'finished' }] },
      feedback: { feedbacktext: '<p>Good.</p>' },
    });

    expect(details).toMatchObject({
      kind: 'quiz',
      title: 'Quiz 1',
      descriptionText: 'Covers week 1.',
      grade: '7.5 / 10.0',
      feedbackText: 'Good.',
      fields: {
        Closes: 'Wednesday, 31 December 2025, 11:59 PM',
        'Time limit': '1 hour 30 mins',
        'Attempts allowed': 'Unlimited',
        'Attempts made': '1',
        'Highest grade': '7.5 / 10.0',
      },
    });
  });
});

describe('itemViewCmid', () => {
  it('accepts assignment and quiz view pages only', () => {
    expect(itemViewCmid(ASSIGN_URL)).toBe('12');
    expect(itemViewCmid(QUIZ_URL)).toBe('40');
    expect(itemViewCmid(`${ORIGIN}/mod/quiz/review.php?attempt=3`)).toBeNull();
    expect(itemViewCmid(`${ORIGIN}/mod/assign/view.php?id=0`)).toBeNull();
    expect(itemViewCmid('not a url')).toBeNull();
  });
});

describe('EclassHybridProvider item details', () => {
  function playwright() {
    return {
      getItemDetails: vi.fn(async (url: string) => ({
        kind: 'assign' as const,
        url,
        title: 'HTML',
      })),
    } as unknown as EclassScraperDependency & {
      getItemDetails: ReturnType<typeof vi.fn>;
    };
  }

  function rest(modname = 'assign') {
    return {
      getCourseModule: vi.fn(async (cmid: string | number) => ({
        id: Number(cmid),
        course: 101,
        modname,
        instance: 1,
      })),
      getAssignments: vi.fn(async () => assignments()),
      getSubmissionStatus: vi.fn(async () => submittedStatus()),
      getQuizzes: vi.fn(async () => quizzes()),
      getQuizBestGrade: vi.fn(async () => ({ hasgrade: true, grade: 7.5 })),
      getQuizAttempts: vi.fn(async () => ({ attempts: [] })),
      getQuizFeedback: vi.fn(async () => ({ feedbacktext: 'Good.' })),
    } satisfies Partial<RestReader>;
  }

  function hybrid(
    restClient: ReturnType<typeof rest>,
    html = playwright(),
    mode: 'api' | 'shadow' | 'playwright' = 'api'
  ) {
    return new EclassHybridProvider({
      playwright: html,
      restClient: restClient as unknown as RestReader,
      hasMobileCredential: () => true,
      mode,
      origin: ORIGIN,
    });
  }

  it('reads an assignment through REST in api mode', async () => {
    const client = rest();
    const html = playwright();

    const details = await hybrid(client, html).getItemDetails(ASSIGN_URL);

    expect(details).toMatchObject({ kind: 'assign', title: 'Lab 1' });
    expect(client.getAssignments).toHaveBeenCalledWith(['101']);
    expect(client.getSubmissionStatus).toHaveBeenCalledWith(301);
    expect(html.getItemDetails).not.toHaveBeenCalled();
  });

  it('reads a quiz through REST, asking for feedback only with a grade', async () => {
    const client = rest('quiz');

    const details = await hybrid(client).getItemDetails(QUIZ_URL);

    expect(details).toMatchObject({ kind: 'quiz', feedbackText: 'Good.' });
    expect(client.getQuizFeedback).toHaveBeenCalledWith(70, 7.5);

    client.getQuizBestGrade.mockResolvedValue({ hasgrade: false, grade: 0 });
    client.getQuizFeedback.mockClear();
    await hybrid(client).getItemDetails(QUIZ_URL);
    expect(client.getQuizFeedback).not.toHaveBeenCalled();
  });

  it('degrades an unreadable submission status but fails on a rate limit', async () => {
    const client = rest();
    client.getSubmissionStatus.mockRejectedValueOnce(
      new MoodleApiError({ category: 'invalid_parameter' })
    );
    await expect(
      hybrid(client).getItemDetails(ASSIGN_URL)
    ).resolves.toMatchObject({
      fields: { 'Submission status': 'Unknown (status unavailable)' },
    });

    client.getSubmissionStatus.mockRejectedValueOnce(
      new MoodleApiError({ category: 'rate_limited', status: 429 })
    );
    const html = playwright();
    await expect(
      hybrid(client, html).getItemDetails(ASSIGN_URL)
    ).rejects.toMatchObject({ category: 'rate_limited' });
    expect(html.getItemDetails).not.toHaveBeenCalled();
  });

  it('falls back to Playwright for other modules or a missing instance', async () => {
    vi.spyOn(rootLogger, 'warn').mockImplementation((() => undefined) as never);
    const html = playwright();
    await hybrid(rest('lesson'), html).getItemDetails(ASSIGN_URL);
    expect(html.getItemDetails).toHaveBeenCalledTimes(1);

    const client = rest();
    client.getAssignments.mockResolvedValue(
      MoodleRestAssignmentsDataSchema.parse({ courses: [] })
    );
    await hybrid(client, html).getItemDetails(ASSIGN_URL);
    expect(html.getItemDetails).toHaveBeenCalledTimes(2);
  });

  it('keeps shadow mode, other pages and foreign hosts off REST', async () => {
    const client = rest();
    const html = playwright();

    await hybrid(client, html, 'shadow').getItemDetails(ASSIGN_URL);
    await hybrid(client, html).getItemDetails(
      `${ORIGIN}/mod/quiz/review.php?attempt=3`
    );
    expect(client.getCourseModule).not.toHaveBeenCalled();
    expect(html.getItemDetails).toHaveBeenCalledTimes(2);

    await expect(
      hybrid(client, html).getItemDetails(
        'https://evil.example/mod/assign/view.php?id=12'
      )
    ).rejects.toThrow();
    expect(client.getCourseModule).not.toHaveBeenCalled();
  });
});
