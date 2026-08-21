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
});
