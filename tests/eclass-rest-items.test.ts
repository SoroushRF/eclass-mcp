import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EclassScraperDependency } from '../src/tools/dependencies';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import {
  EclassHybridProvider,
  itemViewCmid,
  sectionRef,
  type RestReader,
} from '../src/scraper/eclass/api/hybrid';
import {
  formatMoodleDate,
  mapRestAssignmentDetails,
  mapRestQuizDetails,
  mapRestSectionText,
  mapRestSubmissionPreflight,
} from '../src/scraper/eclass/api/rest-items';
import {
  MoodleRestAssignmentsDataSchema,
  MoodleRestCourseContentsSchema,
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

describe('REST section text', () => {
  const SECTION_URL = `${ORIGIN}/course/view.php?id=101&section=1`;

  function contents() {
    return MoodleRestCourseContentsSchema.parse([
      {
        id: 11,
        section: 1,
        name: 'Week 1',
        summary: `<p>Outcomes</p><p>See <a href="/mod/page/view.php?id=3">notes</a> and <a href="https://www.webassign.net/web/Student">WebAssign</a>.</p>`,
        modules: [
          {
            id: 20,
            modname: 'label',
            description: `<p>Lab rules</p><img src="${ORIGIN}/webservice/pluginfile.php/1/mod_label/intro/x.png">`,
          },
          {
            id: 21,
            modname: 'label',
            visible: 0,
            description: '<p>Hidden</p>',
          },
          { id: 22, modname: 'resource', name: 'Slides' },
        ],
      },
    ]);
  }

  it('reads the summary and visible labels, with absolute links', () => {
    const result = mapRestSectionText(contents(), 1, SECTION_URL);

    expect(result).toMatchObject({
      url: SECTION_URL,
      title: 'Week 1',
      mainText: 'Outcomes\nSee notes and WebAssign.\nLab rules',
      mainLinks: [
        { name: 'notes', url: `${ORIGIN}/mod/page/view.php?id=3` },
        { name: 'WebAssign', url: 'https://www.webassign.net/web/Student' },
      ],
      tabs: [],
    });
    expect(result?.external_platforms?.map((p) => p.url)).toContain(
      'https://www.webassign.net/web/Student'
    );
    expect(mapRestSectionText(contents(), 2, SECTION_URL)).toBeNull();
  });

  it('parses only course pages that name a section', () => {
    expect(sectionRef(SECTION_URL)).toEqual({ courseId: '101', section: 1 });
    expect(sectionRef(`${ORIGIN}/course/view.php?id=101&section=0`)).toEqual({
      courseId: '101',
      section: 0,
    });
    expect(sectionRef(`${ORIGIN}/course/view.php?id=101`)).toBeNull();
    expect(sectionRef(`${ORIGIN}/course/view.php?id=101&section=x`)).toBeNull();
    expect(sectionRef(`${ORIGIN}/mod/page/view.php?id=1&section=1`)).toBeNull();
  });

  it('routes section text through REST in api mode and falls back when the section is missing', async () => {
    vi.spyOn(rootLogger, 'warn').mockImplementation((() => undefined) as never);
    const getCourseContents = vi.fn(async () => contents());
    const html = {
      getSectionText: vi.fn(async (url: string) => ({
        url,
        title: 'HTML',
        mainText: '',
        mainLinks: [],
        tabs: [],
      })),
    } as unknown as EclassScraperDependency & {
      getSectionText: ReturnType<typeof vi.fn>;
    };
    const build = (mode: 'api' | 'shadow') =>
      new EclassHybridProvider({
        playwright: html,
        restClient: { getCourseContents } as unknown as RestReader,
        hasMobileCredential: () => true,
        mode,
        origin: ORIGIN,
      });

    await expect(
      build('api').getSectionText(SECTION_URL)
    ).resolves.toMatchObject({ title: 'Week 1' });
    expect(getCourseContents).toHaveBeenCalledWith('101', [
      { name: 'sectionnumber', value: 1 },
    ]);
    expect(html.getSectionText).not.toHaveBeenCalled();

    await build('api').getSectionText(
      `${ORIGIN}/course/view.php?id=101&section=2`
    );
    expect(html.getSectionText).toHaveBeenCalledTimes(1);

    getCourseContents.mockClear();
    await build('shadow').getSectionText(SECTION_URL);
    await build('api').getSectionText(`${ORIGIN}/course/view.php?id=101`);
    expect(getCourseContents).not.toHaveBeenCalled();
    expect(html.getSectionText).toHaveBeenCalledTimes(3);
  });
});

describe('REST submission preflight', () => {
  function configured(
    configs: Array<{ plugin: string; name: string; value: string }>
  ) {
    const [assignment] = assignments().courses[0]!.assignments;
    return {
      ...assignment!,
      configs: configs.map((config) => ({
        ...config,
        subtype: 'assignsubmission',
      })),
    };
  }

  const FILE_CONFIGS = [
    { plugin: 'file', name: 'enabled', value: '1' },
    { plugin: 'file', name: 'maxfilesubmissions', value: '2' },
    { plugin: 'file', name: 'maxsubmissionsizebytes', value: '0' },
    { plugin: 'file', name: 'filetypeslist', value: '.pdf, .zip' },
    { plugin: 'onlinetext', name: 'enabled', value: '0' },
    { plugin: 'comments', name: 'enabled', value: '1' },
  ];

  function status(submission: string, canedit: boolean) {
    const base = submittedStatus();
    return MoodleRestSubmissionStatusSchema.parse({
      ...base,
      lastattempt: {
        ...base.lastattempt,
        submission: { ...base.lastattempt!.submission, status: submission },
        canedit,
        cansubmit: !canedit,
      },
    });
  }

  it('builds upload slots from the assignment settings', () => {
    const preflight = mapRestSubmissionPreflight({
      url: ASSIGN_URL,
      courseId: '101',
      assignment: configured(
        FILE_CONFIGS.map((config) =>
          config.plugin === 'onlinetext' ? { ...config, value: '1' } : config
        )
      ),
      status: status('draft', true),
    });

    expect(preflight).toMatchObject({
      kind: 'assign',
      cmId: '12',
      courseId: '101',
      title: 'Lab 1',
      dueDate: 'Wednesday, 31 December 2025, 11:59 PM',
      dueDateIso: '2026-01-01T04:59:00.000Z',
      submissionState: 'Draft (not submitted)',
      isFinalized: false,
      canEditSubmission: true,
      canSubmitFinal: false,
    });
    expect(preflight?.uploadSlots).toEqual([
      {
        kind: 'file',
        label: 'File submissions',
        canUpload: true,
        maxBytes: undefined,
        maxFiles: 2,
        accepts: ['.pdf', '.zip'],
        currentFiles: [{ name: 'lab1.zip' }],
      },
      { kind: 'online_text', label: 'Online text', canUpload: true },
    ]);
  });

  it('marks a submitted, locked assignment as finalized with no upload', () => {
    const preflight = mapRestSubmissionPreflight({
      url: ASSIGN_URL,
      courseId: '101',
      assignment: configured(FILE_CONFIGS),
      status: status('submitted', false),
    });

    expect(preflight).toMatchObject({
      isFinalized: true,
      canEditSubmission: false,
      uploadSlots: [{ kind: 'file', canUpload: false }],
    });
  });

  it('returns null without submission settings', () => {
    const [assignment] = assignments().courses[0]!.assignments;
    expect(
      mapRestSubmissionPreflight({
        url: ASSIGN_URL,
        courseId: '101',
        assignment: assignment!,
        status: status('new', true),
      })
    ).toBeNull();
  });

  it('routes the preflight through REST and falls back when status is unreadable', async () => {
    vi.spyOn(rootLogger, 'warn').mockImplementation((() => undefined) as never);
    const data = MoodleRestAssignmentsDataSchema.parse({
      courses: [{ id: 101, assignments: [configured(FILE_CONFIGS)] }],
    });
    const client = {
      getCourseModule: vi.fn(async () => ({
        id: 12,
        course: 101,
        modname: 'assign',
        instance: 301,
      })),
      getAssignments: vi.fn(async () => data),
      getSubmissionStatus: vi.fn(async () => status('new', true)),
    };
    const html = {
      getAssignmentSubmissionPreflight: vi.fn(async (url: string) => ({
        kind: 'assign' as const,
        url,
        title: 'HTML',
        uploadSlots: [],
      })),
    } as unknown as EclassScraperDependency & {
      getAssignmentSubmissionPreflight: ReturnType<typeof vi.fn>;
    };
    const build = (mode: 'api' | 'shadow' = 'api') =>
      new EclassHybridProvider({
        playwright: html,
        restClient: client as unknown as RestReader,
        hasMobileCredential: () => true,
        mode,
        origin: ORIGIN,
      });

    await expect(
      build().getAssignmentSubmissionPreflight(ASSIGN_URL)
    ).resolves.toMatchObject({ title: 'Lab 1', canEditSubmission: true });
    expect(html.getAssignmentSubmissionPreflight).not.toHaveBeenCalled();

    client.getSubmissionStatus.mockRejectedValueOnce(
      new MoodleApiError({ category: 'invalid_parameter', upstreamCode: 'x' })
    );
    await expect(
      build().getAssignmentSubmissionPreflight(ASSIGN_URL)
    ).rejects.toMatchObject({ category: 'invalid_parameter' });

    client.getSubmissionStatus.mockRejectedValueOnce(
      new MoodleApiError({ category: 'upstream' })
    );
    await expect(
      build().getAssignmentSubmissionPreflight(ASSIGN_URL)
    ).resolves.toMatchObject({ title: 'HTML' });

    client.getCourseModule.mockClear();
    await build('shadow').getAssignmentSubmissionPreflight(ASSIGN_URL);
    await build().getAssignmentSubmissionPreflight(QUIZ_URL);
    expect(client.getCourseModule).not.toHaveBeenCalled();
    expect(html.getAssignmentSubmissionPreflight).toHaveBeenCalledTimes(3);
  });
});
