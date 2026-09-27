import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  createCookieFreeSiteInfoReader,
  formatMobileProbeReport,
  mobileProbePassed,
  runMobileProbe,
  writeMobileFunctionList,
} from '../src/scraper/eclass/api/mobile-probe';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';

const TOKEN = '0123456789abcdef0123456789abcdef';
const PRIVATE_TOKEN = 'p'.repeat(64);

const credential = {
  service: 'moodle_mobile_app' as const,
  token: TOKEN,
  privateToken: PRIVATE_TOKEN,
  issuedAt: '2026-09-27T00:00:00.000Z',
};

const siteInfo = {
  sitename: 'Private Site Name',
  username: 'student-username',
  userid: 987654,
  release: '5.1+ (Build: 20260901)',
  version: '2025100600.01',
  functions: [
    { name: 'core_course_get_contents', version: '1' },
    { name: 'mod_forum_get_forums_by_courses', version: '1' },
    { name: 'core_webservice_get_site_info', version: '1' },
    { name: 'core_course_get_contents', version: '1' },
    { name: 'not a valid name!', version: '1' },
  ],
};

describe('mobile probe', () => {
  it('reports only shapes and public function names', async () => {
    const { report, functionNames } = await runMobileProbe({
      launch: async () => credential,
      getSiteInfo: async () => siteInfo,
    });

    expect(mobileProbePassed(report)).toBe(true);
    expect(report).toMatchObject({
      minted: true,
      credentialSource: 'minted',
      identityVerified: true,
      tokenLength: 32,
      tokenIsHex32: true,
      privateTokenPresent: true,
      release: '5.1+ (Build: 20260901)',
      version: '2025100600.01',
      functionCount: 3,
    });
    expect(report.routing?.core_course_get_contents).toBe(true);
    expect(report.routing?.gradereport_user_get_grade_items).toBe(false);
    expect(functionNames).toEqual([
      'core_course_get_contents',
      'core_webservice_get_site_info',
      'mod_forum_get_forums_by_courses',
    ]);

    const printed = formatMobileProbeReport(report) + JSON.stringify(report);
    for (const secret of [
      TOKEN,
      PRIVATE_TOKEN,
      'Private Site Name',
      'student-username',
      '987654',
    ]) {
      expect(printed).not.toContain(secret);
    }
  });

  it('reports mint failures by category only', async () => {
    const { report } = await runMobileProbe({
      launch: async () => {
        throw new MoodleApiError({ category: 'malformed_response' });
      },
      getSiteInfo: async () => siteInfo,
    });
    expect(report).toEqual({
      minted: false,
      mintError: 'malformed_response',
    });
    expect(formatMobileProbeReport(report)).toContain('minted: no');
  });

  it('reports REST failures with the Moodle error code', async () => {
    const { report } = await runMobileProbe({
      launch: async () => ({ ...credential, privateToken: undefined }),
      getSiteInfo: async () => {
        throw new MoodleApiError({
          category: 'mobile_token_invalid',
          upstreamCode: 'invalidtoken',
        });
      },
    });
    expect(report).toMatchObject({
      minted: true,
      privateTokenPresent: false,
      restError: 'mobile_token_invalid:invalidtoken',
    });
  });

  it('fails on an empty function list or a missing user id', async () => {
    const cases: Array<[unknown, string]> = [
      [{ ...siteInfo, functions: [] }, 'no_functions'],
      [{ ...siteInfo, functions: undefined }, 'no_functions'],
      [{ ...siteInfo, userid: 0 }, 'missing_userid'],
      [{ ...siteInfo, userid: undefined }, 'missing_userid'],
      [{ unexpected: true }, 'missing_userid'],
      ['not json', 'malformed_response'],
    ];
    for (const [raw, restError] of cases) {
      const { report } = await runMobileProbe({
        launch: async () => credential,
        getSiteInfo: async () => raw,
      });
      expect(report.restError).toBe(restError);
      expect(mobileProbePassed(report)).toBe(false);
      expect(formatMobileProbeReport(report)).toContain('result: FAIL');
    }
  });

  it('verifies a stored token without minting', async () => {
    const getSiteInfo = vi.fn(async () => siteInfo);
    const { report } = await runMobileProbe({
      launch: async () => credential,
      credentialSource: 'stored',
      getSiteInfo,
    });
    expect(report.credentialSource).toBe('stored');
    expect(getSiteInfo).toHaveBeenCalledWith(credential);
    expect(formatMobileProbeReport(report)).toContain('result: PASS');
  });

  it('reads site info over fetch with the token and no cookie', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(siteInfo), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );
    const read = createCookieFreeSiteInfoReader({
      origin: 'https://eclass.yorku.ca',
      timeoutMs: 1000,
      fetchImpl,
    });

    await expect(read(credential)).resolves.toMatchObject({ userid: 987654 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eclass.yorku.ca/webservice/rest/server.php');
    const headers = new Headers(init.headers);
    expect(headers.has('cookie')).toBe(false);
    expect(init.credentials ?? 'omit').not.toBe('include');
    expect(new URLSearchParams(String(init.body)).get('wstoken')).toBe(TOKEN);
  });

  it('writes the function list as JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-probe-'));
    const file = path.join(dir, 'debug', 'mobile-functions.json');
    writeMobileFunctionList(file, ['a_b', 'c_d']);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      functions: ['a_b', 'c_d'],
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
