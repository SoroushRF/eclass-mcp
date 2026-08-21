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
    const grades = await provider.getGrades();

    expect(courses[0]?.id).toBe('101');
    expect(deadlines[0]?.id).toBe('7001');
    expect(grades).toEqual([]);
    expect(api.getEnrolledCourses).toHaveBeenCalledTimes(1);
    expect(api.getCalendarActionEventsByTimesort).toHaveBeenCalledTimes(1);
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
    await provider.getSectionText(
      `${ORIGIN}/course/view.php?id=101&section=1`
    );
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
});
