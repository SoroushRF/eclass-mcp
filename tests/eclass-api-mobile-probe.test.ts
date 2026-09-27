import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  formatMobileProbeReport,
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

    expect(report).toMatchObject({
      minted: true,
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
