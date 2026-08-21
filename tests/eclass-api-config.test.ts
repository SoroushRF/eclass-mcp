import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ECLASS_API_TIMEOUT_MS,
  DEFAULT_ECLASS_SOURCE_MODE,
  ECLASS_AJAX_METHODS,
  ECLASS_AJAX_PATH,
  ECLASS_DEFAULT_ORIGIN,
  ECLASS_MOBILE_LAUNCH_PATH,
  ECLASS_REST_PATH,
  getEclassApiConfig,
  parseEclassApiTimeoutMs,
  parseEclassSourceMode,
} from '../src/scraper/eclass/api/constants';

describe('eClass API configuration', () => {
  it('uses Playwright and the safe timeout by default', () => {
    expect(parseEclassSourceMode(undefined)).toBe(DEFAULT_ECLASS_SOURCE_MODE);
    expect(parseEclassApiTimeoutMs(undefined)).toBe(
      DEFAULT_ECLASS_API_TIMEOUT_MS
    );
    expect(getEclassApiConfig({} as NodeJS.ProcessEnv)).toMatchObject({
      origin: ECLASS_DEFAULT_ORIGIN,
      sourceMode: 'playwright',
      timeoutMs: DEFAULT_ECLASS_API_TIMEOUT_MS,
    });
  });

  it('accepts only the documented source modes', () => {
    expect(parseEclassSourceMode('playwright')).toBe('playwright');
    expect(parseEclassSourceMode('SHADOW')).toBe('shadow');
    expect(parseEclassSourceMode(' api ')).toBe('api');
    expect(() => parseEclassSourceMode('native-fetch')).toThrow(
      /playwright, shadow, api/
    );
  });

  it('validates timeout bounds and rejects malformed values', () => {
    expect(parseEclassApiTimeoutMs('2500')).toBe(2500);
    expect(() => parseEclassApiTimeoutMs('0')).toThrow();
    expect(() => parseEclassApiTimeoutMs('60001')).toThrow();
    expect(() => parseEclassApiTimeoutMs('not-a-number')).toThrow();
  });

  it('normalizes the configured site to an HTTPS origin', () => {
    expect(
      getEclassApiConfig({
        ECLASS_URL: 'https://eclass.yorku.ca/eclass/',
        ECLASS_API_SOURCE_MODE: 'shadow',
        ECLASS_API_TIMEOUT_MS: '12000',
      })
    ).toEqual({
      origin: ECLASS_DEFAULT_ORIGIN,
      sourceMode: 'shadow',
      timeoutMs: 12000,
    });

    expect(() =>
      getEclassApiConfig({ ECLASS_URL: 'http://eclass.yorku.ca' })
    ).toThrow(/HTTPS/);
    expect(() =>
      getEclassApiConfig({
        ECLASS_URL: 'https://user:pass@eclass.yorku.ca',
      })
    ).toThrow(/credentials/);
  });

  it('keeps API endpoint paths and proven method names centralized', () => {
    expect(ECLASS_AJAX_PATH).toBe('/lib/ajax/service.php');
    expect(ECLASS_REST_PATH).toBe('/webservice/rest/server.php');
    expect(ECLASS_MOBILE_LAUNCH_PATH).toBe('/admin/tool/mobile/launch.php');
    expect(ECLASS_AJAX_METHODS.enrolledCourses).toBe(
      'core_course_get_enrolled_courses_by_timeline_classification'
    );
  });
});
