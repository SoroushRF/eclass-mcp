import siteInfoFixture from './fixtures/eclass-api/rest-site-info.json';
import missingFunctionsFixture from './fixtures/eclass-api/rest-missing-functions.json';
import invalidTokenFixture from './fixtures/eclass-api/rest-invalid-token.json';
import malformedFixture from './fixtures/eclass-api/rest-malformed.json';
import courseContentsFixture from './fixtures/eclass-api/rest-course-contents.json';
import { describe, expect, it, vi } from 'vitest';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import {
  MOODLE_REST_CAPABILITIES,
  MoodleRestClient,
} from '../src/scraper/eclass/api/rest';
import type { MobileCredential } from '../src/scraper/session';

function credential(token: string): MobileCredential {
  return {
    service: 'moodle_mobile_app',
    token,
    issuedAt: '2026-08-21T20:00:00.000Z',
  };
}

describe('capability-gated Moodle REST client', () => {
  it('discovers function names once and gates typed course-content calls', async () => {
    const postRest = vi
      .fn()
      .mockResolvedValueOnce(siteInfoFixture)
      .mockResolvedValueOnce(courseContentsFixture);
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: {
        load: () => credential('token-one'),
        clear: vi.fn(),
      },
    });

    const capabilities = await client.discoverCapabilities();
    const contents = await client.getCourseContents(101);
    await client.discoverCapabilities();

    expect([...capabilities]).toContain(
      MOODLE_REST_CAPABILITIES.courseContents
    );
    expect(contents[0]?.modules[0]?.modname).toBe('resource');
    expect(postRest).toHaveBeenCalledTimes(2);
    expect(postRest).toHaveBeenLastCalledWith(
      MOODLE_REST_CAPABILITIES.courseContents,
      { courseid: 101 },
      'token-one'
    );
  });

  it('routes missing functions as capability-unavailable without probing them', async () => {
    const postRest = vi.fn(async () => missingFunctionsFixture);
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: {
        load: () => credential('token-one'),
        clear: vi.fn(),
      },
    });

    await expect(client.getGradeItems(101)).rejects.toMatchObject({
      category: 'capability_unavailable',
      upstreamCode: MOODLE_REST_CAPABILITIES.gradeItems,
    });
    expect(postRest).toHaveBeenCalledTimes(1);
    expect(postRest).toHaveBeenCalledWith(
      MOODLE_REST_CAPABILITIES.siteInfo,
      {},
      'token-one'
    );
  });

  it('invalidates an invalid token and performs one bounded re-mint retry', async () => {
    let activeCredential = credential('token-one');
    const clear = vi.fn(() => {
      activeCredential = credential('cleared');
    });
    const reMint = vi.fn(async () => {
      activeCredential = credential('token-two');
      return activeCredential;
    });
    const postRest = vi
      .fn()
      .mockResolvedValueOnce(siteInfoFixture)
      .mockResolvedValueOnce(invalidTokenFixture)
      .mockResolvedValueOnce(courseContentsFixture);
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: {
        load: () => activeCredential,
        clear,
      },
      reMint,
    });

    await expect(client.getCourseContents(101)).resolves.toHaveLength(2);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(reMint).toHaveBeenCalledTimes(1);
    expect(postRest).toHaveBeenNthCalledWith(
      2,
      MOODLE_REST_CAPABILITIES.courseContents,
      { courseid: 101 },
      'token-one'
    );
    expect(postRest).toHaveBeenNthCalledWith(
      3,
      MOODLE_REST_CAPABILITIES.courseContents,
      { courseid: 101 },
      'token-two'
    );
  });

  it('classifies REST errors and malformed site-info without exposing response text', async () => {
    const clear = vi.fn();
    const invalidClient = new MoodleRestClient({
      transport: { postRest: vi.fn(async () => invalidTokenFixture) },
      credentialReader: { load: () => credential('token-one'), clear },
    });
    await expect(invalidClient.discoverCapabilities()).rejects.toMatchObject({
      category: 'mobile_token_invalid',
    });
    expect(clear).toHaveBeenCalledTimes(1);

    const malformedClient = new MoodleRestClient({
      transport: { postRest: vi.fn(async () => malformedFixture) },
      credentialReader: {
        load: () => credential('token-one'),
        clear: vi.fn(),
      },
    });
    await expect(malformedClient.discoverCapabilities()).rejects.toMatchObject({
      category: 'malformed_response',
    });

    const missingCredentialClient = new MoodleRestClient({
      transport: { postRest: vi.fn() },
      credentialReader: { load: () => null, clear: vi.fn() },
    });
    await expect(
      missingCredentialClient.discoverCapabilities()
    ).rejects.toMatchObject({
      category: 'mobile_token_invalid',
    });
    expect(() => new MoodleApiError({ category: 'upstream' })).not.toThrow();
  });

  it('exposes cached capability helpers and validates each supported read shape', async () => {
    const postRest = vi
      .fn()
      .mockResolvedValueOnce(siteInfoFixture)
      .mockResolvedValueOnce(siteInfoFixture)
      .mockResolvedValueOnce({ courses: [] })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ usergrades: [] })
      .mockResolvedValueOnce({ usergrades: [] });
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: {
        load: () => credential('token-one'),
        clear: vi.fn(),
      },
    });

    await client.discoverCapabilities();

    await expect(
      client.hasCapability(MOODLE_REST_CAPABILITIES.gradeItems)
    ).resolves.toBe(true);
    await expect(client.hasCapability('missing_function')).resolves.toBe(false);
    expect(client.getCapabilityNames()).toEqual([
      MOODLE_REST_CAPABILITIES.courseContents,
      MOODLE_REST_CAPABILITIES.siteInfo,
      MOODLE_REST_CAPABILITIES.gradeItems,
      MOODLE_REST_CAPABILITIES.assignments,
      MOODLE_REST_CAPABILITIES.forums,
    ]);

    await expect(
      client.callCapability(MOODLE_REST_CAPABILITIES.siteInfo)
    ).resolves.toEqual(siteInfoFixture);
    await expect(client.getAssignments(['101', '202'])).resolves.toEqual({
      courses: [],
    });
    await expect(client.getForums(['101'])).resolves.toEqual([]);
    await expect(client.getGradeItems('101')).resolves.toEqual({
      usergrades: [],
    });
    await expect(client.getGradeItems()).resolves.toEqual({ usergrades: [] });

    expect(postRest).toHaveBeenNthCalledWith(
      3,
      MOODLE_REST_CAPABILITIES.assignments,
      { courseids: [101, 202] },
      'token-one'
    );
    expect(postRest).toHaveBeenNthCalledWith(
      4,
      MOODLE_REST_CAPABILITIES.forums,
      { courseids: [101] },
      'token-one'
    );
    expect(postRest).toHaveBeenNthCalledWith(
      5,
      MOODLE_REST_CAPABILITIES.gradeItems,
      { courseid: 101 },
      'token-one'
    );
    expect(postRest).toHaveBeenNthCalledWith(
      6,
      MOODLE_REST_CAPABILITIES.gradeItems,
      {},
      'token-one'
    );
  });

  it('maps REST authentication and service errors to stable categories', async () => {
    const cases = [
      ['requireloginerror', 'session_invalid'],
      ['invalidsesskey', 'session_invalid'],
      ['accessdenied', 'session_invalid'],
      ['servicenotavailable', 'capability_unavailable'],
      ['unexpected_error', 'upstream'],
    ] as const;

    for (const [errorcode, category] of cases) {
      const client = new MoodleRestClient({
        transport: {
          postRest: vi.fn(async () => ({ errorcode, message: 'redacted' })),
        },
        credentialReader: {
          load: () => credential('token-one'),
          clear: vi.fn(),
        },
      });

      await expect(client.discoverCapabilities()).rejects.toMatchObject({
        category,
        upstreamCode: errorcode,
      });
    }
  });

  it('rejects malformed typed REST payloads after capability discovery', async () => {
    const postRest = vi
      .fn()
      .mockResolvedValueOnce(siteInfoFixture)
      .mockResolvedValueOnce({ courses: 'not-an-array' })
      .mockResolvedValueOnce({ forums: 'not-an-array' })
      .mockResolvedValueOnce({ usergrades: 'not-an-array' })
      .mockResolvedValueOnce([{ id: 1, modules: 'not-an-array' }]);
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: {
        load: () => credential('token-one'),
        clear: vi.fn(),
      },
    });

    await expect(client.getAssignments(['101'])).rejects.toMatchObject({
      category: 'malformed_response',
    });
    await expect(client.getForums(['101'])).rejects.toMatchObject({
      category: 'malformed_response',
    });
    await expect(client.getGradeItems()).rejects.toMatchObject({
      category: 'malformed_response',
    });
    await expect(client.getCourseContents(101)).rejects.toMatchObject({
      category: 'malformed_response',
    });
  });

  it('fails closed when the default encrypted mobile credential is absent', async () => {
    const client = new MoodleRestClient({
      transport: { postRest: vi.fn() },
    });

    await expect(client.discoverCapabilities()).rejects.toMatchObject({
      category: 'mobile_token_invalid',
    });
  });
});

describe('REST credential lifecycle', () => {
  const USER_COURSES = MOODLE_REST_CAPABILITIES.userCourses;

  /** Fake Moodle keyed by token: each valid token is one user. */
  function fakeMoodle(users: Record<string, number>) {
    return vi.fn(
      async (fn: string, args: Record<string, unknown>, token: string) => {
        const userId = users[token];
        if (userId === undefined) return invalidTokenFixture;
        if (fn === MOODLE_REST_CAPABILITIES.siteInfo) {
          return {
            ...siteInfoFixture,
            userid: userId,
            functions: [...siteInfoFixture.functions, { name: USER_COURSES }],
          };
        }
        if (fn === USER_COURSES) {
          return args.userid === userId
            ? [{ id: 100 + userId, shortname: `C${userId}` }]
            : { errorcode: 'accessexception', exception: 'x', message: 'x' };
        }
        return courseContentsFixture;
      }
    );
  }

  it('rediscovers identity when the stored credential is replaced', async () => {
    let active: MobileCredential | null = credential('token-a');
    const identities: string[] = [];
    const postRest = fakeMoodle({ 'token-a': 7, 'token-b': 9 });
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: { load: () => active, clear: () => (active = null) },
      onIdentity: (id) => identities.push(id),
    });

    await expect(client.getVerifiedUserId()).resolves.toBe('7');
    await expect(client.getUserCourses()).resolves.toMatchObject([{ id: 107 }]);

    active = credential('token-b');
    await expect(client.getUserCourses()).resolves.toMatchObject([{ id: 109 }]);
    await expect(client.getVerifiedUserId()).resolves.toBe('9');
    expect(identities).toEqual(['7', '9']);
    expect(postRest.mock.calls.filter(([fn]) => fn === USER_COURSES)).toEqual([
      [USER_COURSES, { userid: 7 }, 'token-a'],
      [USER_COURSES, { userid: 9 }, 'token-b'],
    ]);
  });

  it('shares one renewal across concurrent invalid-token reads', async () => {
    let active: MobileCredential | null = credential('token-old');
    const users: Record<string, number> = { 'token-old': 7 };
    const postRest = fakeMoodle(users);
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: { load: () => active, clear: () => (active = null) },
      reMint: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        active = credential('token-new');
        return active;
      }),
    });
    await client.discoverCapabilities();
    delete users['token-old'];
    users['token-new'] = 7;

    const reads = await Promise.all(
      [101, 102, 103, 104].map((id) => client.getCourseContents(id))
    );

    expect(reads).toHaveLength(4);
    expect(
      (client as unknown as { reMint: ReturnType<typeof vi.fn> }).reMint
    ).toHaveBeenCalledTimes(1);
  });

  it('reports a failed renewal as an invalid mobile token', async () => {
    let active: MobileCredential | null = credential('token-old');
    const client = new MoodleRestClient({
      transport: { postRest: fakeMoodle({}) },
      credentialReader: { load: () => active, clear: () => (active = null) },
      reMint: async () => {
        throw new Error('launch failed');
      },
    });

    await expect(client.discoverCapabilities()).rejects.toMatchObject({
      category: 'mobile_token_invalid',
      upstreamCode: 'renewal_failed',
    });
    expect(active).toBeNull();
  });

  it('does not clear a credential that replaced the failed one', async () => {
    let active: MobileCredential | null = credential('token-old');
    const clear = vi.fn(() => (active = null));
    const postRest = vi.fn(async () => {
      // Another login stores a new token while this request is in flight.
      active = credential('token-other');
      return invalidTokenFixture;
    });
    const client = new MoodleRestClient({
      transport: { postRest },
      credentialReader: { load: () => active, clear },
    });

    await expect(client.discoverCapabilities()).rejects.toMatchObject({
      category: 'mobile_token_invalid',
    });
    expect(clear).not.toHaveBeenCalled();
    expect(active).toMatchObject({ token: 'token-other' });
  });

  it('lets file downloads share the renewal', async () => {
    let active: MobileCredential | null = credential('token-old');
    const reMint = vi.fn(async () => {
      active = credential('token-new');
      return active;
    });
    const client = new MoodleRestClient({
      transport: { postRest: vi.fn() },
      credentialReader: { load: () => active, clear: () => (active = null) },
      reMint,
    });
    const download = vi.fn(async (token: string) => {
      if (token === 'token-old') {
        throw new MoodleApiError({ category: 'mobile_token_invalid' });
      }
      return 'file';
    });

    await expect(client.withCredential(download)).resolves.toMatchObject({
      value: 'file',
    });
    expect(reMint).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenLastCalledWith('token-new');
  });
});
