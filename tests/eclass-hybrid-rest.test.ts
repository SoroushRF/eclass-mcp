import courseContentsFixture from './fixtures/eclass-api/rest-course-contents.json';
import userCoursesFixture from './fixtures/eclass-api/rest-user-courses.json';
import gradeItemsFixture from './fixtures/eclass-api/rest-grade-items.json';
import overviewGradesFixture from './fixtures/eclass-api/rest-overview-grades.json';
import forumsFixture from './fixtures/eclass-api/rest-forums.json';
import discussionsFixture from './fixtures/eclass-api/rest-forum-discussions.json';
import assignmentsFixture from './fixtures/eclass-api/rest-assignments.json';
import submissionStatusFixture from './fixtures/eclass-api/rest-submission-status.json';
import calendarFixture from './fixtures/eclass-api/ajax-calendar.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EclassScraperDependency } from '../src/tools/dependencies';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import {
  EclassHybridProvider,
  type RestReader,
} from '../src/scraper/eclass/api/hybrid';
import {
  extractHtmlLinks,
  htmlToPlainText,
  submissionStatusLabel,
} from '../src/scraper/eclass/api/rest-mappers';
import {
  MoodleAjaxResponseSchema,
  MoodleCalendarDataSchema,
  MoodleRestAssignmentsDataSchema,
  MoodleRestCourseContentsSchema,
  MoodleRestForumDiscussionsSchema,
  MoodleRestForumsDataSchema,
  MoodleRestGradeItemsDataSchema,
  MoodleRestOverviewGradesSchema,
  MoodleRestSubmissionStatusSchema,
  MoodleRestUserCoursesSchema,
} from '../src/scraper/eclass/api/types';
import { rootLogger } from '../src/logging/logger';

const ORIGIN = 'https://eclass.yorku.ca';

afterEach(() => {
  vi.restoreAllMocks();
});

function quietLogs() {
  vi.spyOn(rootLogger, 'info').mockImplementation((() => undefined) as never);
  vi.spyOn(rootLogger, 'warn').mockImplementation((() => undefined) as never);
}

function htmlProvider(): EclassScraperDependency {
  return {
    getCourses: vi.fn(async () => [
      {
        id: '999',
        name: 'HTML Course',
        url: `${ORIGIN}/course/view.php?id=999`,
      },
    ]),
    getCourseContent: vi.fn(async (courseId: string) => ({
      courseId,
      sections: [
        {
          title: 'HTML section',
          items: [
            {
              type: 'resource' as const,
              name: 'HTML resource',
              url: `${ORIGIN}/mod/resource/view.php?id=900`,
            },
          ],
        },
      ],
    })),
    getDeadlines: vi.fn(async () => []),
    getAllAssignmentDeadlines: vi.fn(async () => []),
    getItemDetails: vi.fn(),
    getAssignmentSubmissionPreflight: vi.fn(),
    downloadFile: vi.fn(),
    getSectionText: vi.fn(),
    getGrades: vi.fn(async () => [
      {
        courseId: '999',
        itemName: 'HTML grade',
        grade: '1',
        range: '-',
        percentage: '-',
        feedback: '',
      },
    ]),
    getAnnouncements: vi.fn(async () => []),
  } as unknown as EclassScraperDependency;
}

function restReader() {
  const calendar = MoodleAjaxResponseSchema.parse(calendarFixture)[0];
  return {
    getCourseContents: vi.fn(async () =>
      MoodleRestCourseContentsSchema.parse(courseContentsFixture)
    ),
    getUserCourses: vi.fn(async () =>
      MoodleRestUserCoursesSchema.parse(userCoursesFixture)
    ),
    getActionEventsByTimesort: vi.fn(
      async (_args: {
        timesortfrom: number;
        limitnum: number;
        aftereventid?: number;
      }) => MoodleCalendarDataSchema.parse(calendar?.data)
    ),
    getActionEventsByCourse: vi.fn(
      async (_args: {
        courseid: number;
        timesortfrom: number;
        limitnum: number;
        aftereventid?: number;
      }) => MoodleCalendarDataSchema.parse(calendar?.data)
    ),
    hasCapability: vi.fn(async (_name: string) => false),
    getAssignments: vi.fn(async () =>
      MoodleRestAssignmentsDataSchema.parse(assignmentsFixture)
    ),
    getSubmissionStatus: vi.fn(async () =>
      MoodleRestSubmissionStatusSchema.parse(submissionStatusFixture)
    ),
    getForums: vi.fn(async () =>
      MoodleRestForumsDataSchema.parse(forumsFixture)
    ),
    getForumDiscussions: vi.fn(async () =>
      MoodleRestForumDiscussionsSchema.parse(discussionsFixture)
    ),
    getGradeItems: vi.fn(async () =>
      MoodleRestGradeItemsDataSchema.parse(gradeItemsFixture)
    ),
    getOverviewGrades: vi.fn(async () =>
      MoodleRestOverviewGradesSchema.parse(overviewGradesFixture)
    ),
  } satisfies RestReader;
}

function provider(
  options: Partial<ConstructorParameters<typeof EclassHybridProvider>[0]> = {}
) {
  const playwright = options.playwright ?? htmlProvider();
  const rest =
    (options.restClient as ReturnType<typeof restReader>) ?? restReader();
  return {
    playwright,
    rest,
    hybrid: new EclassHybridProvider({
      playwright,
      restClient: rest,
      mode: 'api',
      origin: ORIGIN,
      ...options,
    }),
  };
}

describe('REST mapping helpers', () => {
  it('turns Moodle HTML into plain text and extracts anchors', () => {
    expect(htmlToPlainText('<p>A &amp; B</p><p>C&nbsp;D<br>E</p>')).toBe(
      'A & B\nC D\nE'
    );
    expect(htmlToPlainText('<script>alert(1)</script>ok')).toBe('ok');
    expect(
      extractHtmlLinks(
        `<a href="https://example.com/a?x=1&amp;y=2">A <b>link</b></a><a href='/rel'>R</a>`
      )
    ).toEqual([
      { name: 'A link', url: 'https://example.com/a?x=1&y=2' },
      { name: 'R', url: '/rel' },
    ]);
  });

  it('uses Moodle assignment-index wording for submission status', () => {
    expect(submissionStatusLabel(null)).toBe('Unknown (status unavailable)');
    expect(submissionStatusLabel({})).toBe('Unknown (status unavailable)');
    expect(submissionStatusLabel({ lastattempt: {} })).toBe('No submission');
    expect(
      submissionStatusLabel({
        lastattempt: { submission: { status: 'draft' } },
      })
    ).toBe('Draft (not submitted)');
    expect(
      submissionStatusLabel({
        lastattempt: { teamsubmission: { status: 'submitted' } },
      })
    ).toBe('Submitted for grading');
    // Team assignments return both records; the team one is authoritative.
    expect(
      submissionStatusLabel({
        lastattempt: {
          submission: { status: 'new' },
          teamsubmission: { status: 'submitted' },
        },
      })
    ).toBe('Submitted for grading');
  });
});

describe('EclassHybridProvider REST routing', () => {
  it('serves course content from REST in api mode with visible modules only', async () => {
    const { hybrid, rest, playwright } = provider();

    const content = await hybrid.getCourseContent('101');

    expect(rest.getCourseContents).toHaveBeenCalledWith('101');
    expect(playwright.getCourseContent).not.toHaveBeenCalled();
    expect(content.courseId).toBe('101');
    expect(content.sections.map((section) => section.title)).toEqual([
      'General',
      'Week 1',
    ]);
    expect(content.sections[1]?.items).toEqual([
      {
        type: 'assign',
        name: 'Sample assignment',
        url: `${ORIGIN}/mod/assign/view.php?id=12`,
      },
      {
        type: 'lti',
        name: 'Sample external tool',
        url: `${ORIGIN}/mod/lti/view.php?id=14`,
      },
    ]);
  });

  it('falls back from REST to session AJAX, then to Playwright', async () => {
    quietLogs();
    const rest = restReader();
    rest.getCourseContents.mockRejectedValue(
      new MoodleApiError({ category: 'capability_unavailable' })
    );
    const apiClient = {
      getEnrolledCourses: vi.fn(),
      getCourseFormatState: vi.fn(async () => {
        throw new MoodleApiError({ category: 'upstream' });
      }),
      getCalendarUpcoming: vi.fn(),
      getCalendarActionEventsByTimesort: vi.fn(),
    };
    const { hybrid, playwright } = provider({ restClient: rest, apiClient });

    const content = await hybrid.getCourseContent('101');

    expect(rest.getCourseContents).toHaveBeenCalledTimes(1);
    expect(apiClient.getCourseFormatState).toHaveBeenCalledTimes(1);
    expect(playwright.getCourseContent).toHaveBeenCalledTimes(1);
    expect(content.sections[0]?.title).toBe('HTML section');
  });

  it('skips REST entirely without a stored mobile credential', async () => {
    const { hybrid, rest, playwright } = provider({
      hasMobileCredential: () => false,
    });

    await hybrid.getCourseContent('101');
    await hybrid.getGrades('101');
    await hybrid.getAllAssignmentDeadlines();

    expect(rest.getCourseContents).not.toHaveBeenCalled();
    expect(rest.getGradeItems).not.toHaveBeenCalled();
    expect(rest.getAssignments).not.toHaveBeenCalled();
    expect(playwright.getCourseContent).toHaveBeenCalledTimes(1);
    expect(playwright.getGrades).toHaveBeenCalledTimes(1);
  });

  it('never calls REST in playwright mode', async () => {
    const { hybrid, rest, playwright } = provider({ mode: 'playwright' });

    await hybrid.getGrades();
    await hybrid.getCourseContent('101');

    expect(rest.getOverviewGrades).not.toHaveBeenCalled();
    expect(rest.getCourseContents).not.toHaveBeenCalled();
    expect(playwright.getGrades).toHaveBeenCalledTimes(1);
  });

  it('returns Playwright results in shadow mode while exercising REST', async () => {
    quietLogs();
    const { hybrid, rest } = provider({ mode: 'shadow', shadowTimeoutMs: 500 });

    const grades = await hybrid.getGrades('101');

    expect(grades[0]?.itemName).toBe('HTML grade');
    expect(rest.getGradeItems).toHaveBeenCalledWith('101');
  });

  it('maps per-course grade items, hiding hidden grades', async () => {
    const { hybrid } = provider();

    await expect(hybrid.getGrades('101')).resolves.toEqual([
      {
        courseId: '101',
        itemName: 'Sample assignment',
        grade: '8.00',
        range: '0–10',
        percentage: '80.00 %',
        feedback: 'Good & clear.',
      },
      {
        courseId: '101',
        itemName: 'Course total',
        grade: '80.00',
        range: '0–100',
        percentage: '80.00 %',
        feedback: '',
      },
    ]);
  });

  it('maps overview grades with course names from the enrolment list', async () => {
    const { hybrid, rest } = provider();

    const grades = await hybrid.getGrades();

    expect(rest.getOverviewGrades).toHaveBeenCalledTimes(1);
    expect(grades.map((grade) => [grade.courseId, grade.itemName])).toEqual([
      ['101', 'TEST 1001 - Example Course'],
      ['303', 'Course 303'],
    ]);
  });

  it('reads announcements from the course news forum', async () => {
    const { hybrid, rest, playwright } = provider();

    const announcements = await hybrid.getAnnouncements('101', 1);

    expect(rest.getForums).toHaveBeenCalledWith(['101']);
    expect(rest.getForumDiscussions).toHaveBeenCalledWith(501, 1);
    expect(playwright.getAnnouncements).not.toHaveBeenCalled();
    expect(announcements).toEqual([
      {
        id: '8001',
        title: 'Welcome to the course',
        content: 'Hello & welcome.\nSee the syllabus and the course page.',
        date: '2026-01-01T00:00:00.000Z',
        author: 'Example Instructor',
        discussionUrl: `${ORIGIN}/mod/forum/discuss.php?d=8001`,
        links: [
          {
            name: 'the syllabus',
            url: 'https://example.com/syllabus',
            sourceDiscussionUrl: `${ORIGIN}/mod/forum/discuss.php?d=8001`,
          },
        ],
      },
    ]);
  });

  it('returns no announcements when the course has no news forum', async () => {
    const rest = restReader();
    rest.getForums.mockResolvedValue(
      MoodleRestForumsDataSchema.parse([
        { id: 1, course: 101, type: 'general' },
      ])
    );
    const { hybrid } = provider({ restClient: rest });

    await expect(hybrid.getAnnouncements('101')).resolves.toEqual([]);
    expect(rest.getForumDiscussions).not.toHaveBeenCalled();
  });

  it('keeps site-level announcements on Playwright', async () => {
    const { hybrid, rest, playwright } = provider();

    await hybrid.getAnnouncements(undefined, 5);

    expect(rest.getForums).not.toHaveBeenCalled();
    expect(playwright.getAnnouncements).toHaveBeenCalledWith(undefined, 5);
  });

  it('builds the assignment index with read-only submission status', async () => {
    quietLogs();
    const rest = restReader();
    rest.getSubmissionStatus
      .mockResolvedValueOnce(
        MoodleRestSubmissionStatusSchema.parse(submissionStatusFixture)
      )
      .mockRejectedValueOnce(new MoodleApiError({ category: 'upstream' }));
    const { hybrid, playwright } = provider({ restClient: rest });

    const items = await hybrid.getAllAssignmentDeadlines();

    expect(rest.getAssignments).toHaveBeenCalledWith(['101', '202']);
    expect(rest.getSubmissionStatus).toHaveBeenCalledTimes(2);
    expect(playwright.getAllAssignmentDeadlines).not.toHaveBeenCalled();
    expect(items).toEqual([
      expect.objectContaining({
        id: '12',
        name: 'Sample assignment',
        dueDate: '2026-01-01T00:00:00.000Z',
        status: 'Submitted for grading',
        submission: 'Submitted for grading',
        grade: '8.00 / 10.00',
        type: 'assign',
        courseId: '101',
        courseCode: 'TEST1001',
        url: `${ORIGIN}/mod/assign/view.php?id=12`,
      }),
      expect.objectContaining({
        id: '15',
        dueDate: '',
        status: 'Unknown (status unavailable)',
        grade: '-',
      }),
    ]);
  });

  it('uses the personal extension as the effective due date', async () => {
    quietLogs();
    const rest = restReader();
    const extension = 1767225600 + 86_400;
    rest.getSubmissionStatus.mockResolvedValue(
      MoodleRestSubmissionStatusSchema.parse({
        lastattempt: {
          submission: { status: 'new' },
          extensionduedate: extension,
        },
      })
    );
    const { hybrid } = provider({ restClient: rest });

    const [first] = await hybrid.getAllAssignmentDeadlines('101');

    expect(first).toMatchObject({
      id: '12',
      dueDate: new Date(extension * 1000).toISOString(),
      status: 'No submission',
      submission: 'No submission; extension granted',
    });
  });

  it('reports an unreadable status as unknown, not as no submission', async () => {
    quietLogs();
    const rest = restReader();
    rest.getSubmissionStatus.mockRejectedValue(
      new MoodleApiError({ category: 'timeout' })
    );
    const { hybrid } = provider({ restClient: rest });

    const items = await hybrid.getAllAssignmentDeadlines('101');

    expect(items.map((item) => item.status)).toEqual([
      'Unknown (status unavailable)',
      'Unknown (status unavailable)',
    ]);
  });

  it('fails the assignment index on a rate limit instead of hiding it', async () => {
    const rest = restReader();
    rest.getSubmissionStatus.mockRejectedValue(
      new MoodleApiError({ category: 'rate_limited', status: 429 })
    );
    const { hybrid, playwright } = provider({ restClient: rest });

    await expect(hybrid.getAllAssignmentDeadlines('101')).rejects.toMatchObject(
      { category: 'rate_limited' }
    );
    expect(playwright.getAllAssignmentDeadlines).not.toHaveBeenCalled();
  });

  it('keeps course lists and deadlines on AJAX, using REST only when AJAX fails', async () => {
    quietLogs();
    const calendar = MoodleAjaxResponseSchema.parse(calendarFixture)[0];
    const apiClient = {
      getEnrolledCourses: vi.fn(async () => {
        throw new MoodleApiError({ category: 'session_invalid' });
      }),
      getCourseFormatState: vi.fn(),
      getCalendarUpcoming: vi.fn(async () =>
        MoodleCalendarDataSchema.parse(calendar?.data)
      ),
      getCalendarActionEventsByTimesort: vi.fn(async () => {
        throw new MoodleApiError({ category: 'session_invalid' });
      }),
    };
    const { hybrid, rest, playwright } = provider({ apiClient });

    const courses = await hybrid.getCourses();
    const upcoming = await hybrid.getDeadlines('101');
    const deadlines = await hybrid.getDeadlines();

    expect(courses.map((course) => course.id)).toEqual(['101', '202']);
    expect(rest.getUserCourses).toHaveBeenCalledTimes(1);
    expect(apiClient.getCalendarUpcoming).toHaveBeenCalledWith('101');
    expect(upcoming[0]?.id).toBe('7001');
    expect(rest.getActionEventsByTimesort).toHaveBeenCalledTimes(1);
    expect(deadlines[0]?.id).toBe('7001');
    expect(playwright.getCourses).not.toHaveBeenCalled();
  });

  it('serves token-only api reads without touching the cookie session', async () => {
    const apiClient = {
      getEnrolledCourses: vi.fn(),
      getCourseFormatState: vi.fn(),
      getCalendarUpcoming: vi.fn(),
      getCalendarActionEventsByTimesort: vi.fn(),
    };
    const { hybrid, rest, playwright } = provider({
      apiClient,
      hasCookieSession: () => false,
    });

    await expect(hybrid.getCourses()).resolves.toHaveLength(2);
    await hybrid.getDeadlines();
    await hybrid.getCourseContent('101');

    expect(rest.getUserCourses).toHaveBeenCalledTimes(1);
    expect(rest.getActionEventsByTimesort).toHaveBeenCalled();
    expect(rest.getCourseContents).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(apiClient)) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(playwright.getCourses).not.toHaveBeenCalled();
  });

  it('reports the AJAX error when the REST fallback also fails', async () => {
    quietLogs();
    const rest = restReader();
    rest.getUserCourses.mockRejectedValue(
      new MoodleApiError({ category: 'mobile_token_invalid' })
    );
    const apiClient = {
      getEnrolledCourses: vi.fn(async () => {
        throw new MoodleApiError({ category: 'session_invalid' });
      }),
      getCourseFormatState: vi.fn(),
      getCalendarUpcoming: vi.fn(),
      getCalendarActionEventsByTimesort: vi.fn(),
    };
    const { hybrid, playwright } = provider({ restClient: rest, apiClient });

    await expect(hybrid.getCourses()).rejects.toMatchObject({
      category: 'session_invalid',
    });
    expect(playwright.getCourses).not.toHaveBeenCalled();
  });

  it('does not add REST traffic after an AJAX rate limit', async () => {
    const apiClient = {
      getEnrolledCourses: vi.fn(async () => {
        throw new MoodleApiError({ category: 'rate_limited', status: 429 });
      }),
      getCourseFormatState: vi.fn(),
      getCalendarUpcoming: vi.fn(),
      getCalendarActionEventsByTimesort: vi.fn(),
    };
    const { hybrid, rest } = provider({ apiClient });

    await expect(hybrid.getCourses()).rejects.toMatchObject({
      category: 'rate_limited',
    });
    expect(rest.getUserCourses).not.toHaveBeenCalled();
  });

  it('keeps a validation failure instead of falling back to Playwright', async () => {
    quietLogs();
    const rest = restReader();
    rest.getGradeItems.mockRejectedValue(
      new MoodleApiError({ category: 'invalid_parameter' })
    );
    const { hybrid, playwright } = provider({ restClient: rest });

    await expect(hybrid.getGrades('101')).rejects.toMatchObject({
      publicCode: 'VALIDATION_FAILED',
    });
    expect(playwright.getGrades).not.toHaveBeenCalled();
  });

  it('reports a terminal REST error over the earlier AJAX error', async () => {
    quietLogs();
    const rest = restReader();
    rest.getUserCourses.mockRejectedValue(
      new MoodleApiError({ category: 'invalid_parameter' })
    );
    const apiClient = {
      getEnrolledCourses: vi.fn(async () => {
        throw new MoodleApiError({ category: 'session_invalid' });
      }),
      getCourseFormatState: vi.fn(),
      getCalendarUpcoming: vi.fn(),
      getCalendarActionEventsByTimesort: vi.fn(),
    };
    const { hybrid } = provider({ restClient: rest, apiClient });

    await expect(hybrid.getCourses()).rejects.toMatchObject({
      category: 'invalid_parameter',
    });
  });

  it('reports the AJAX error when REST course content is unusable', async () => {
    quietLogs();
    const rest = restReader();
    rest.getCourseContents.mockRejectedValue(
      new MoodleApiError({ category: 'capability_unavailable' })
    );
    const apiClient = {
      getEnrolledCourses: vi.fn(),
      getCourseFormatState: vi.fn(async () => {
        throw new MoodleApiError({ category: 'rate_limited', status: 429 });
      }),
      getCalendarUpcoming: vi.fn(),
      getCalendarActionEventsByTimesort: vi.fn(),
    };
    const { hybrid, playwright } = provider({ restClient: rest, apiClient });

    await expect(hybrid.getCourseContent('101')).rejects.toMatchObject({
      category: 'rate_limited',
    });
    expect(playwright.getCourseContent).not.toHaveBeenCalled();
  });
});

describe('REST calendar paging', () => {
  const ajaxDown = () => ({
    getEnrolledCourses: vi.fn(),
    getCourseFormatState: vi.fn(),
    getCalendarUpcoming: vi.fn(async () => {
      throw new MoodleApiError({ category: 'session_invalid' });
    }),
    getCalendarActionEventsByTimesort: vi.fn(async () => {
      throw new MoodleApiError({ category: 'session_invalid' });
    }),
  });

  function event(id: number, courseId: number) {
    return {
      id,
      name: `Event ${id}`,
      timesort: 1_900_000_000 + id,
      modulename: 'assign',
      url: `${ORIGIN}/mod/assign/view.php?id=${id}`,
      course: { id: courseId, fullname: `Course ${courseId}` },
    };
  }

  it('pages past the first 50 global events to find the requested course', async () => {
    quietLogs();
    const rest = restReader();
    const pageOne = Array.from({ length: 50 }, (_, i) => event(i + 1, 101));
    rest.getActionEventsByTimesort
      .mockResolvedValueOnce(
        MoodleCalendarDataSchema.parse({ events: pageOne })
      )
      .mockResolvedValueOnce(
        MoodleCalendarDataSchema.parse({ events: [event(51, 202)] })
      );
    const { hybrid } = provider({ restClient: rest, apiClient: ajaxDown() });

    const deadlines = await hybrid.getDeadlines('202');

    expect(deadlines.map((item) => item.id)).toEqual(['51']);
    expect(rest.getActionEventsByTimesort).toHaveBeenCalledTimes(2);
    expect(rest.getActionEventsByTimesort.mock.calls[1]?.[0]).toMatchObject({
      aftereventid: 50,
    });
  });

  it('uses the course-scoped function when the token has it', async () => {
    quietLogs();
    const rest = restReader();
    rest.hasCapability.mockResolvedValue(true);
    rest.getActionEventsByCourse.mockResolvedValue(
      MoodleCalendarDataSchema.parse({ events: [event(9, 202)] })
    );
    const { hybrid } = provider({ restClient: rest, apiClient: ajaxDown() });

    const deadlines = await hybrid.getDeadlines('202');

    expect(deadlines.map((item) => item.id)).toEqual(['9']);
    expect(rest.getActionEventsByCourse).toHaveBeenCalledWith(
      expect.objectContaining({ courseid: 202, limitnum: 50 })
    );
    expect(rest.getActionEventsByTimesort).not.toHaveBeenCalled();
  });

  it('fails instead of returning a truncated list at the page bound', async () => {
    quietLogs();
    const rest = restReader();
    let next = 1;
    rest.getActionEventsByTimesort.mockImplementation(async () =>
      MoodleCalendarDataSchema.parse({
        events: Array.from({ length: 50 }, () => event(next++, 101)),
      })
    );
    const { hybrid } = provider({ restClient: rest, apiClient: ajaxDown() });

    await expect(hybrid.getDeadlines('202')).rejects.toMatchObject({
      category: 'session_invalid',
    });
    expect(rest.getActionEventsByTimesort).toHaveBeenCalledTimes(10);
  });
});

describe('shadow evidence', () => {
  function captureWarnings() {
    const lines: string[] = [];
    vi.spyOn(rootLogger, 'info').mockImplementation((() => undefined) as never);
    vi.spyOn(rootLogger, 'warn').mockImplementation(((...args: unknown[]) => {
      lines.push(JSON.stringify(args));
    }) as never);
    return lines;
  }

  it('does not count a read that fell back as a clean API validation', async () => {
    const logs = captureWarnings();
    const apiClient = {
      getEnrolledCourses: vi.fn(async () => {
        throw new MoodleApiError({ category: 'upstream' });
      }),
      getCourseFormatState: vi.fn(),
      getCalendarUpcoming: vi.fn(),
      getCalendarActionEventsByTimesort: vi.fn(),
    };
    const { hybrid, rest } = provider({
      mode: 'shadow',
      shadowTimeoutMs: 500,
      apiClient,
    });

    await hybrid.getCourses();

    expect(rest.getUserCourses).toHaveBeenCalledTimes(1);
    const mismatch = logs.find((line) =>
      line.includes('eClass API shadow mismatch')
    );
    expect(mismatch).toContain('api_path_fell_back');
  });

  it('stops submission-status fan-out once the shadow window expires', async () => {
    quietLogs();
    const base = MoodleRestAssignmentsDataSchema.parse(assignmentsFixture);
    const template = base.courses[0]!.assignments[0]!;
    const many = {
      ...base,
      courses: [
        {
          ...base.courses[0]!,
          assignments: Array.from({ length: 20 }, (_, index) => ({
            ...template,
            id: 5000 + index,
          })),
        },
      ],
    };
    const rest = restReader();
    rest.getAssignments.mockResolvedValue(many);
    rest.getSubmissionStatus.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return MoodleRestSubmissionStatusSchema.parse(submissionStatusFixture);
    });
    const { hybrid, playwright } = provider({
      mode: 'shadow',
      shadowTimeoutMs: 10,
      restClient: rest,
    });

    await hybrid.getAllAssignmentDeadlines('101');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(playwright.getAllAssignmentDeadlines).toHaveBeenCalledTimes(1);
    expect(rest.getSubmissionStatus.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
