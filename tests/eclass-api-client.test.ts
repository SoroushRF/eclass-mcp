import coursesFixture from './fixtures/eclass-api/ajax-courses.json';
import courseStateFixture from './fixtures/eclass-api/ajax-course-state.json';
import calendarFixture from './fixtures/eclass-api/ajax-calendar.json';
import errorFixture from './fixtures/eclass-api/ajax-errors.json';
import { describe, expect, it, vi } from 'vitest';
import {
  MoodleAjaxClient,
  PROVEN_MOODLE_AJAX_METHODS,
} from '../src/scraper/eclass/api/client';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import type { MoodleTransport } from '../src/scraper/eclass/api/transport';
import type { EclassApiSession } from '../src/scraper/eclass/api/session-context';

function session(sesskey: string): EclassApiSession {
  return {
    context: {} as EclassApiSession['context'],
    request: {} as EclassApiSession['request'],
    sesskey,
    userId: '42',
    accountScope: 'acct_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function provider(initial: EclassApiSession, refreshed = initial) {
  return {
    getSession: vi.fn(async () => initial),
    refresh: vi.fn(async () => refreshed),
  };
}

describe('MoodleAjaxClient', () => {
  it('calls the allowlisted enrolled-course method with the proven arguments', async () => {
    const transport: MoodleTransport = {
      postAjax: vi.fn(async () => coursesFixture),
      postRest: vi.fn(),
    };
    const sessionContext = provider(session('sesskey'));
    const transportFactory = vi.fn(() => transport);
    const client = new MoodleAjaxClient({
      sessionContext,
      transportFactory,
    });

    const result = await client.getEnrolledCourses();

    expect(result.courses).toHaveLength(2);
    expect(transportFactory).toHaveBeenCalledTimes(1);
    expect(transport.postAjax).toHaveBeenCalledWith(
      [
        {
          index: 0,
          methodname:
            'core_course_get_enrolled_courses_by_timeline_classification',
          args: {
            classification: 'all',
            limit: 0,
            offset: 0,
            sort: 'fullname',
          },
        },
      ],
      'sesskey'
    );
  });

  it('parses stringified course-format state exactly once', async () => {
    const transport: MoodleTransport = {
      postAjax: vi.fn(async () => courseStateFixture),
      postRest: vi.fn(),
    };
    const client = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => transport,
    });

    const state = await client.getCourseFormatState(101);

    expect(state.course.id).toBe(101);
    expect(state.section[0]?.title).toBe('General');
    expect(state.cm[0]?.modname).toBe('resource');
  });

  it('parses calendar functions and preserves empty event data', async () => {
    const transport: MoodleTransport = {
      postAjax: vi
        .fn()
        .mockResolvedValueOnce(calendarFixture)
        .mockResolvedValueOnce([{ error: false, data: { events: [] } }]),
      postRest: vi.fn(),
    };
    const client = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => transport,
    });

    await expect(client.getCalendarUpcoming(1)).resolves.toMatchObject({
      events: [{ id: 7001 }],
    });
    await expect(
      client.getCalendarActionEventsByTimesort({
        timesortfrom: 1780000000,
        limitnum: 50,
      })
    ).resolves.toEqual({ events: [] });
    expect(transport.postAjax).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          methodname: PROVEN_MOODLE_AJAX_METHODS[3],
          args: { timesortfrom: 1780000000, limitnum: 50 },
        }),
      ],
      'sesskey'
    );
  });

  it('rejects methods outside the proven AJAX allowlist before transport', async () => {
    const postAjax = vi.fn();
    const client = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => ({
        postAjax,
        postRest: vi.fn(),
      }),
    });

    await expect(
      client.call('core_course_get_contents', { courseid: 101 })
    ).rejects.toMatchObject({
      category: 'capability_unavailable',
      upstreamCode: 'method_not_allowlisted',
    });
    expect(postAjax).not.toHaveBeenCalled();
  });

  it('maps Moodle error entries and refreshes once on invalid sesskey', async () => {
    const refreshedSession = session('new-sesskey');
    const firstTransport: MoodleTransport = {
      postAjax: vi.fn(async () => errorFixture),
      postRest: vi.fn(),
    };
    const secondTransport: MoodleTransport = {
      postAjax: vi.fn(async () => coursesFixture),
      postRest: vi.fn(),
    };
    const sessionContext = {
      getSession: vi
        .fn()
        .mockResolvedValueOnce(session('old-sesskey'))
        .mockResolvedValue(refreshedSession),
      refresh: vi.fn(async () => refreshedSession),
    };
    const transportFactory = vi
      .fn()
      .mockReturnValueOnce(firstTransport)
      .mockReturnValueOnce(secondTransport);
    const client = new MoodleAjaxClient({
      sessionContext,
      transportFactory,
    });

    await expect(client.getEnrolledCourses()).rejects.toMatchObject({
      category: 'capability_unavailable',
    });

    const sessionErrorTransport: MoodleTransport = {
      postAjax: vi.fn(async () => {
        throw new MoodleApiError({ category: 'session_invalid' });
      }),
      postRest: vi.fn(),
    };
    const retryTransport: MoodleTransport = {
      postAjax: vi.fn(async () => coursesFixture),
      postRest: vi.fn(),
    };
    const retryContext = {
      getSession: vi
        .fn()
        .mockResolvedValueOnce(session('old'))
        .mockResolvedValueOnce(refreshedSession),
      refresh: vi.fn(async () => refreshedSession),
    };
    const retryFactory = vi
      .fn()
      .mockReturnValueOnce(sessionErrorTransport)
      .mockReturnValueOnce(retryTransport);
    const retryClient = new MoodleAjaxClient({
      sessionContext: retryContext,
      transportFactory: retryFactory,
    });

    await expect(retryClient.getEnrolledCourses()).resolves.toHaveProperty(
      'courses'
    );
    expect(retryContext.refresh).toHaveBeenCalledTimes(1);
    expect(sessionErrorTransport.postAjax).toHaveBeenCalledTimes(1);
    expect(retryTransport.postAjax).toHaveBeenCalledWith(
      expect.any(Array),
      'new-sesskey'
    );
  });

  it('converts malformed upstream data into a stable API error', async () => {
    const transport: MoodleTransport = {
      postAjax: vi.fn(async () => [{ error: false, data: { wrong: true } }]),
      postRest: vi.fn(),
    };
    const client = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => transport,
    });

    await expect(client.getEnrolledCourses()).rejects.toMatchObject({
      category: 'malformed_response',
    });
  });

  it('validates course IDs and includes optional calendar arguments', async () => {
    const transport: MoodleTransport = {
      postAjax: vi
        .fn()
        .mockResolvedValueOnce([{ error: false, data: { events: [] } }])
        .mockResolvedValueOnce([{ error: false, data: { events: [] } }]),
      postRest: vi.fn(),
    };
    const client = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => transport,
    });

    await expect(client.getCalendarUpcoming(0)).rejects.toMatchObject({
      category: 'malformed_response',
    });
    await expect(
      client.getCalendarActionEventsByTimesort({
        timesortfrom: 1780000000.9,
        timesortto: 1780003600.9,
        limitnum: 10.9,
        courseid: '101',
      })
    ).resolves.toEqual({ events: [] });
    expect(transport.postAjax).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          args: {
            timesortfrom: 1780000000,
            timesortto: 1780003600,
            limitnum: 10,
            courseid: 101,
          },
        }),
      ],
      'sesskey'
    );

    await expect(
      client.getCalendarActionEventsByTimesort({
        timesortfrom: 1,
        courseid: 0,
      })
    ).rejects.toMatchObject({ category: 'malformed_response' });
  });

  it('parses object course state, rejects invalid JSON, and uses the default transport', async () => {
    const objectStateTransport: MoodleTransport = {
      postAjax: vi.fn(async () => [
        {
          error: false,
          data: {
            course: { id: 101 },
            section: [],
            cm: [],
          },
        },
      ]),
      postRest: vi.fn(),
    };
    const objectStateClient = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => objectStateTransport,
    });

    await expect(
      objectStateClient.getCourseFormatState(101)
    ).resolves.toMatchObject({
      course: { id: 101 },
    });

    const invalidJsonClient = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => ({
        postAjax: vi.fn(async () => [{ error: false, data: '{invalid-json' }]),
        postRest: vi.fn(),
      }),
    });
    await expect(
      invalidJsonClient.getCourseFormatState(101)
    ).rejects.toMatchObject({ category: 'malformed_response' });

    const defaultRequest = {
      post: vi.fn(async () => ({
        status: () => 200,
        body: async () => Buffer.from(JSON.stringify(coursesFixture)),
      })),
    };
    const defaultSession = session('default-sesskey');
    defaultSession.request =
      defaultRequest as unknown as EclassApiSession['request'];
    const defaultClient = new MoodleAjaxClient({
      sessionContext: provider(defaultSession),
    });

    await expect(defaultClient.getEnrolledCourses()).resolves.toMatchObject({
      courses: expect.any(Array),
    });
    expect(defaultRequest.post).toHaveBeenCalledTimes(1);
  });

  it('classifies non-session AJAX error envelopes without leaking messages', async () => {
    const cases = [
      ['invalidtoken', 'mobile_token_invalid'],
      ['unexpected_error', 'upstream'],
    ] as const;

    for (const [errorcode, category] of cases) {
      const client = new MoodleAjaxClient({
        sessionContext: provider(session('sesskey')),
        transportFactory: () => ({
          postAjax: vi.fn(async () => [
            {
              error: true,
              errorcode,
              message: 'sensitive upstream message',
            },
          ]),
          postRest: vi.fn(),
        }),
      });

      await expect(client.getEnrolledCourses()).rejects.toMatchObject({
        category,
        upstreamCode: errorcode,
      });
    }

    const missingErrorCodeClient = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => ({
        postAjax: vi.fn(async () => [{ error: true }]),
        postRest: vi.fn(),
      }),
    });
    await expect(
      missingErrorCodeClient.getEnrolledCourses()
    ).rejects.toMatchObject({ category: 'upstream' });

    const missingDataClient = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => ({
        postAjax: vi.fn(async () => [{ error: false }]),
        postRest: vi.fn(),
      }),
    });
    await expect(missingDataClient.getEnrolledCourses()).rejects.toMatchObject({
      category: 'malformed_response',
    });

    const emptyEnvelopeClient = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => ({
        postAjax: vi.fn(async () => []),
        postRest: vi.fn(),
      }),
    });
    await expect(
      emptyEnvelopeClient.getEnrolledCourses()
    ).rejects.toMatchObject({ category: 'malformed_response' });

    const invalidEnvelopeClient = new MoodleAjaxClient({
      sessionContext: provider(session('sesskey')),
      transportFactory: () => ({
        postAjax: vi.fn(async () => 'not-an-array'),
        postRest: vi.fn(),
      }),
    });
    await expect(
      invalidEnvelopeClient.getEnrolledCourses()
    ).rejects.toMatchObject({ category: 'malformed_response' });
  });
});
