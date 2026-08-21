import coursesFixture from './fixtures/eclass-api/ajax-courses.json';
import courseStateFixture from './fixtures/eclass-api/ajax-course-state.json';
import calendarFixture from './fixtures/eclass-api/ajax-calendar.json';
import { describe, expect, it, vi } from 'vitest';
import type { EclassScraperDependency } from '../src/tools/dependencies';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import { EclassHybridProvider } from '../src/scraper/eclass/api/hybrid';
import {
  MoodleAjaxResponseSchema,
  MoodleCalendarDataSchema,
  MoodleCourseFormatStateSchema,
  MoodleEnrolledCoursesDataSchema,
} from '../src/scraper/eclass/api/types';

const ORIGIN = 'https://eclass.yorku.ca';

function htmlProvider(
  overrides: Partial<EclassScraperDependency> = {}
): EclassScraperDependency {
  return {
    getCourses: vi.fn(async () => [
      {
        id: 'html-1',
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
    getItemDetails: vi.fn(async (url: string) => ({
      kind: 'assign' as const,
      url,
      title: 'HTML item',
    })),
    getAssignmentSubmissionPreflight: vi.fn(async (url: string) => ({
      kind: 'assign' as const,
      url,
      title: 'HTML item',
      uploadSlots: [],
    })),
    downloadFile: vi.fn(async () => ({
      buffer: Buffer.from('html'),
      mimeType: 'text/plain',
      filename: 'html.txt',
    })),
    getSectionText: vi.fn(async (url: string) => ({
      url,
      title: 'HTML section',
      mainText: 'HTML text',
      mainLinks: [],
      tabs: [],
    })),
    getGrades: vi.fn(async () => []),
    getAnnouncements: vi.fn(async () => []),
    ...overrides,
  };
}

function apiReader() {
  const courseResponse = MoodleAjaxResponseSchema.parse(coursesFixture)[0];
  const stateResponse = MoodleAjaxResponseSchema.parse(courseStateFixture)[0];
  const calendarResponse = MoodleAjaxResponseSchema.parse(calendarFixture)[0];
  return {
    getEnrolledCourses: vi.fn(async () =>
      MoodleEnrolledCoursesDataSchema.parse(courseResponse?.data)
    ),
    getCourseFormatState: vi.fn(async () =>
      MoodleCourseFormatStateSchema.parse(
        JSON.parse(stateResponse?.data as string)
      )
    ),
    getCalendarUpcoming: vi.fn(async () =>
      MoodleCalendarDataSchema.parse(calendarResponse?.data)
    ),
    getCalendarActionEventsByTimesort: vi.fn(async () =>
      MoodleCalendarDataSchema.parse(calendarResponse?.data)
    ),
  };
}

describe('EclassHybridProvider', () => {
  it('uses API-primary for proven reads and keeps unsupported reads in Playwright', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    const courses = await provider.getCourses();
    const deadlines = await provider.getDeadlines();
    const courseDeadlines = await provider.getDeadlines('101');
    const grades = await provider.getGrades();

    expect(courses[0]?.id).toBe('101');
    expect(deadlines[0]?.id).toBe('7001');
    expect(courseDeadlines[0]?.id).toBe('7001');
    expect(grades).toEqual([]);
    expect(api.getEnrolledCourses).toHaveBeenCalledTimes(1);
    expect(api.getCalendarActionEventsByTimesort).toHaveBeenCalledTimes(1);
    expect(api.getCalendarUpcoming).toHaveBeenCalledWith('101');
    expect(playwright.getCourses).not.toHaveBeenCalled();
    expect(playwright.getDeadlines).not.toHaveBeenCalled();
    expect(playwright.getGrades).toHaveBeenCalledTimes(1);
  });

  it('falls back once when API content is incomplete', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    const content = await provider.getCourseContent('101');

    expect(content.sections[0]?.title).toBe('HTML section');
    expect(api.getCourseFormatState).toHaveBeenCalledTimes(1);
    expect(playwright.getCourseContent).toHaveBeenCalledWith('101');
  });

  it('does not add browser traffic for a rate-limited API response', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    api.getEnrolledCourses.mockRejectedValueOnce(
      new MoodleApiError({ category: 'rate_limited', status: 429 })
    );
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    await expect(provider.getCourses()).rejects.toMatchObject({
      category: 'rate_limited',
    });
    expect(playwright.getCourses).not.toHaveBeenCalled();
  });

  it('uses Playwright as the authoritative result in shadow mode', async () => {
    const playwright = htmlProvider({
      getCourses: vi.fn(async () => [
        {
          id: 'html-1',
          name: 'HTML Course',
          url: `${ORIGIN}/course/view.php?id=999`,
        },
      ]),
    });
    const api = apiReader();
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'shadow',
      origin: ORIGIN,
      shadowTimeoutMs: 100,
    });

    const courses = await provider.getCourses();

    expect(courses[0]?.id).toBe('html-1');
    expect(api.getEnrolledCourses).toHaveBeenCalledTimes(1);
    expect(playwright.getCourses).toHaveBeenCalledTimes(1);
  });

  it('delegates full assignment history and rich content reads to Playwright', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    await provider.getAllAssignmentDeadlines('101');
    await provider.getSectionText(`${ORIGIN}/course/view.php?id=101&section=1`);
    await provider.getAssignmentSubmissionPreflight(
      `${ORIGIN}/mod/assign/view.php?id=11`
    );

    expect(playwright.getAllAssignmentDeadlines).toHaveBeenCalledWith('101');
    expect(playwright.getSectionText).toHaveBeenCalledTimes(1);
    expect(playwright.getAssignmentSubmissionPreflight).toHaveBeenCalledTimes(
      1
    );
    expect(api.getCourseFormatState).not.toHaveBeenCalled();
  });

  it('uses Playwright directly when selected and falls back when API is unavailable', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    const playwrightOnly = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'playwright',
      origin: ORIGIN,
    });

    await expect(playwrightOnly.getCourses()).resolves.toEqual(
      await playwright.getCourses()
    );
    expect(api.getEnrolledCourses).not.toHaveBeenCalled();

    const noApiProvider = new EclassHybridProvider({
      playwright,
      mode: 'api',
      origin: ORIGIN,
    });
    await expect(noApiProvider.getCourses()).resolves.toEqual(
      await playwright.getCourses()
    );
    expect(playwright.getCourses).toHaveBeenCalledTimes(4);
  });

  it('falls back for content and deadlines when no API client is configured', async () => {
    const playwright = htmlProvider();
    const provider = new EclassHybridProvider({
      playwright,
      mode: 'api',
      origin: ORIGIN,
    });

    await expect(provider.getCourseContent('101')).resolves.toMatchObject({
      courseId: '101',
    });
    await expect(provider.getDeadlines('101')).resolves.toEqual([]);
    expect(playwright.getCourseContent).toHaveBeenCalledWith('101');
    expect(playwright.getDeadlines).toHaveBeenCalledWith('101');
  });

  it('returns complete API course content and preserves API errors when fallback also fails', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    api.getCourseFormatState.mockImplementation(async () => ({
      course: { id: 101, numsections: 1 },
      section: [{ id: 1, section: 0, title: 'General', cmlist: [11] }],
      cm: [
        {
          id: 11,
          name: 'Resource',
          modname: 'resource',
          sectionid: 1,
          url: `${ORIGIN}/mod/resource/view.php?id=11`,
        },
      ],
    }));
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    await expect(provider.getCourseContent('101')).resolves.toMatchObject({
      courseId: '101',
      sections: [{ title: 'General' }],
    });
    expect(playwright.getCourseContent).not.toHaveBeenCalled();

    const failingPlaywright = htmlProvider({
      getCourses: vi.fn(async () => {
        throw 'playwright failure';
      }),
    });
    const failingApi = apiReader();
    failingApi.getEnrolledCourses.mockRejectedValueOnce('api failure');
    const failingProvider = new EclassHybridProvider({
      playwright: failingPlaywright,
      apiClient: failingApi,
      mode: 'api',
      origin: ORIGIN,
    });

    await expect(failingProvider.getCourses()).rejects.toBe('api failure');
  });

  it('prefers a Playwright Error when both API and fallback fail', async () => {
    const playwrightError = new Error('playwright failure');
    const playwright = htmlProvider({
      getCourses: vi.fn(async () => {
        throw playwrightError;
      }),
    });
    const api = apiReader();
    api.getEnrolledCourses.mockRejectedValueOnce(new Error('api failure'));
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    await expect(provider.getCourses()).rejects.toBe(playwrightError);
  });

  it('falls back from a named API timeout and uses the default announcement limit', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    const timeout = new Error('API timeout');
    timeout.name = 'TimeoutError';
    api.getEnrolledCourses.mockRejectedValueOnce(timeout);
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    await expect(provider.getCourses()).resolves.toEqual(
      await playwright.getCourses()
    );
    await provider.getAnnouncements();
    expect(playwright.getAnnouncements).toHaveBeenCalledWith(undefined, 10);
  });

  it('records both matching and failed shadow reads while returning Playwright data', async () => {
    const matchingCourses = [
      {
        id: '101',
        name: 'Sample Course A',
        url: `${ORIGIN}/course/view.php?id=101`,
      },
      {
        id: '202',
        name: 'Sample Course B',
        url: `${ORIGIN}/course/view.php?id=202`,
      },
    ];
    const matchingPlaywright = htmlProvider({
      getCourses: vi.fn(async () => matchingCourses),
    });
    const matchingProvider = new EclassHybridProvider({
      playwright: matchingPlaywright,
      apiClient: apiReader(),
      mode: 'shadow',
      origin: ORIGIN,
    });

    await expect(matchingProvider.getCourses()).resolves.toEqual(
      matchingCourses
    );

    const failedPlaywright = htmlProvider();
    const failedApi = apiReader();
    failedApi.getEnrolledCourses.mockRejectedValueOnce(
      new MoodleApiError({ category: 'upstream' })
    );
    const failedProvider = new EclassHybridProvider({
      playwright: failedPlaywright,
      apiClient: failedApi,
      mode: 'shadow',
      origin: ORIGIN,
      shadowTimeoutMs: 100,
    });

    await expect(failedProvider.getCourses()).resolves.toEqual(
      await failedPlaywright.getCourses()
    );
  });

  it('returns the Playwright result when a shadow scrape fails', async () => {
    const playwrightError = new Error('shadow scrape failed');
    const playwright = htmlProvider({
      getCourses: vi.fn(async () => {
        throw playwrightError;
      }),
    });
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: apiReader(),
      mode: 'shadow',
      origin: ORIGIN,
    });

    await expect(provider.getCourses()).rejects.toBe(playwrightError);
  });

  it('bounds a hanging shadow API read and preserves the Playwright result', async () => {
    const playwright = htmlProvider();
    const api = apiReader();
    api.getEnrolledCourses.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof api.getEnrolledCourses>>>(
          () => undefined
        )
    );
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'shadow',
      origin: ORIGIN,
      shadowTimeoutMs: 1,
    });

    await expect(provider.getCourses()).resolves.toEqual(
      await playwright.getCourses()
    );
  });

  it('keeps a non-Error Playwright failure when the API rejects undefined', async () => {
    const playwright = htmlProvider({
      getCourses: vi.fn(async () => {
        throw 'playwright failure';
      }),
    });
    const api = apiReader();
    api.getEnrolledCourses.mockImplementation(async () => {
      throw undefined;
    });
    const provider = new EclassHybridProvider({
      playwright,
      apiClient: api,
      mode: 'api',
      origin: ORIGIN,
    });

    await expect(provider.getCourses()).rejects.toBe('playwright failure');
  });

  it('closes the API session and provider-owned resources exactly once', async () => {
    const apiSessionContext = { close: vi.fn(async () => undefined) };
    const closeOwnedResources = vi.fn(async () => undefined);
    const provider = new EclassHybridProvider({
      playwright: htmlProvider(),
      apiSessionContext,
      closeOwnedResources,
      mode: 'playwright',
      origin: ORIGIN,
    });

    await provider.close();

    expect(apiSessionContext.close).toHaveBeenCalledTimes(1);
    expect(closeOwnedResources).toHaveBeenCalledTimes(1);
  });
});
