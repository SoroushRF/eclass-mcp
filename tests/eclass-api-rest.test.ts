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

    await expect(client.getCourseContents(101)).resolves.toHaveLength(1);
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
      .mockResolvedValueOnce({ forums: [] })
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
    await expect(client.getForums(['101'])).resolves.toEqual({ forums: [] });
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
