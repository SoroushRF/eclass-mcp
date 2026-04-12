import { afterEach, describe, expect, it, vi } from 'vitest';
import * as helpers from '../src/scraper/eclass/helpers';
import { getCourses } from '../src/scraper/eclass/courses';
import { getDeadlines } from '../src/scraper/eclass/deadlines';
import { downloadFile } from '../src/scraper/eclass/files';
import { getSectionText } from '../src/scraper/eclass/sections';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('eclass scraper modules zero-coverage lift', () => {
  it('getCourses maps course code metadata from evaluated course rows', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const page = {
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => true),
      evaluate: vi.fn(async () => [
        {
          id: '101',
          name: 'MATH 1010 - Calculus I',
          courseCode: '',
          url: 'https://eclass.yorku.ca/course/view.php?id=101',
        },
      ]),
      close: vi.fn(async () => undefined),
    };

    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
      dumpPage: vi.fn(async () => undefined),
    };

    const courses = await getCourses(session as any);

    expect(courses).toHaveLength(1);
    expect(courses[0]?.courseCode).toBe('MATH1010');
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('getDeadlines returns enriched assignment rows', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const page = {
      goto: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => [
        {
          id: 'd1',
          name: 'Assignment 1',
          dueDate: 'Apr 20, 2026',
          status: 'Upcoming',
          courseId: '101',
          courseName: 'MATH 1010 - Calculus I',
          courseCode: '',
          url: 'https://eclass.yorku.ca/mod/assign/view.php?id=201',
        },
      ]),
      close: vi.fn(async () => undefined),
    };

    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    const deadlines = await getDeadlines(session as any, '101');

    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]?.courseCode).toBe('MATH1010');
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('downloadFile returns binary payload metadata for direct file responses', async () => {
    const response = {
      ok: () => true,
      status: () => 200,
      headers: () => ({
        'content-type': 'application/pdf',
      }),
      body: async () => Buffer.from('pdf-bytes'),
      url: () => 'https://eclass.yorku.ca/pluginfile.php/1/resource',
    };

    const context = {
      request: {
        get: vi.fn(async () => response),
      },
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    const downloaded = await downloadFile(
      session as any,
      'https://eclass.yorku.ca/pluginfile.php/1/resource'
    );

    expect(downloaded.mimeType).toBe('application/pdf');
    expect(downloaded.filename).toBe('resource.pdf');
    expect(downloaded.buffer.toString()).toBe('pdf-bytes');
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('getSectionText sanitizes URL and surfaces detected external platforms', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const evaluatedSection = {
      url: 'https://eclass.yorku.ca/mod/page/view.php?id=148310',
      title: 'Week 2',
      mainText: 'Read chapter 2',
      mainLinks: [
        {
          name: 'Launch WebAssign',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-2001',
        },
      ],
      tabs: [
        {
          title: 'Resources',
          content: 'extra links',
          links: [],
        },
      ],
    };

    const page = {
      goto: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => evaluatedSection),
      close: vi.fn(async () => undefined),
    };

    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    const section = await getSectionText(
      session as any,
      ' https://eclass.yorku.ca/mod/page/view.php?id= 148310 '
    );

    expect(page.goto).toHaveBeenCalledWith(
      'https://eclass.yorku.ca/mod/page/view.php?id=148310',
      expect.objectContaining({ waitUntil: 'domcontentloaded' })
    );
    expect(section.external_platforms).toEqual([
      {
        name: 'cengage',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-2001',
        signal: 'keyword_url',
      },
    ]);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
