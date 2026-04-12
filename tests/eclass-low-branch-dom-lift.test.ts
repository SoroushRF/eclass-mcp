import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as helpers from '../src/scraper/eclass/helpers';
import { getCourses, getCourseContent } from '../src/scraper/eclass/courses';
import {
  getAllAssignmentDeadlines,
  getAssignmentIndexDeadlines,
  getDeadlines,
  getMonthDeadlines,
} from '../src/scraper/eclass/deadlines';
import { getGrades } from '../src/scraper/eclass/grades';
import { getSectionText } from '../src/scraper/eclass/sections';

function restoreGlobal(key: string, previous: unknown): void {
  if (typeof previous === 'undefined') {
    delete (globalThis as Record<string, unknown>)[key];
    return;
  }
  (globalThis as Record<string, unknown>)[key] = previous;
}

function runEvaluateInDom<TArg, TResult>(
  html: string,
  url: string,
  callback: ((arg: TArg) => TResult) | (() => TResult),
  arg?: TArg
): TResult {
  const dom = new JSDOM(html, { url });
  const { window } = dom;

  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      return (this.textContent || '').replace(/\s+/g, ' ').trim();
    },
  });

  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
  const prevHTMLAnchorElement = (globalThis as Record<string, unknown>)
    .HTMLAnchorElement;
  const prevHTMLTimeElement = (globalThis as Record<string, unknown>)
    .HTMLTimeElement;

  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;
  (globalThis as Record<string, unknown>).HTMLAnchorElement =
    window.HTMLAnchorElement;
  (globalThis as Record<string, unknown>).HTMLTimeElement =
    window.HTMLTimeElement;

  try {
    if (typeof arg === 'undefined') {
      return (callback as () => TResult)();
    }
    return (callback as (value: TArg) => TResult)(arg);
  } finally {
    restoreGlobal('window', prevWindow);
    restoreGlobal('document', prevDocument);
    restoreGlobal('HTMLElement', prevHTMLElement);
    restoreGlobal('HTMLAnchorElement', prevHTMLAnchorElement);
    restoreGlobal('HTMLTimeElement', prevHTMLTimeElement);
    window.close();
  }
}

function createDomPage(options: {
  htmlByUrl: Record<string, string>;
  throwOnGotoUrls?: Set<string>;
}) {
  let currentUrl =
    Object.keys(options.htmlByUrl)[0] || 'https://eclass.yorku.ca';

  const goto = vi.fn(async (url: string) => {
    if (options.throwOnGotoUrls?.has(url)) {
      throw new Error(`goto failed for ${url}`);
    }
    currentUrl = url;
  });

  const getHtml = (): string =>
    options.htmlByUrl[currentUrl] ?? options.htmlByUrl['*'] ?? '';

  const evaluate = vi.fn(async (callback: unknown, arg?: unknown) =>
    runEvaluateInDom(
      getHtml(),
      currentUrl,
      callback as ((value: unknown) => unknown) | (() => unknown),
      arg
    )
  );

  const waitForFunction = vi.fn(async (callback: unknown) =>
    runEvaluateInDom(
      getHtml(),
      currentUrl,
      callback as (() => unknown) | ((value: unknown) => unknown)
    )
  );

  const waitForSelector = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);

  return {
    goto,
    evaluate,
    waitForFunction,
    waitForSelector,
    close,
    url: () => currentUrl,
  };
}

function createSessionFromPages(pages: any[]) {
  const pageQueue = [...pages];
  const context = {
    newPage: vi.fn(async () => {
      const next = pageQueue.shift();
      if (!next) {
        throw new Error('No more mock pages available');
      }
      return next;
    }),
    close: vi.fn(async () => undefined),
  };

  const session = {
    getAuthenticatedContext: vi.fn(async () => context),
    dumpPage: vi.fn(async () => undefined),
  };

  return { session, context };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('eclass low-branch DOM paths', () => {
  it('getCourses uses fallback link extraction and deduplicates course ids', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const coursesUrl = 'https://eclass.yorku.ca/my/courses.php';
    const page = createDomPage({
      htmlByUrl: {
        [coursesUrl]: `
          <main>
            <a href="https://eclass.yorku.ca/course/view.php?id=101">Course is starred MATH 1010 - Calculus I Course name</a>
            <a href="https://eclass.yorku.ca/course/view.php?id=101">Duplicate MATH</a>
            <a href="https://eclass.yorku.ca/course/view.php?id=202">CHEM 2020 - Organic Chemistry</a>
          </main>
        `,
      },
    });

    const { session, context } = createSessionFromPages([page]);
    const result = await getCourses(session as any);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['101', '202']);
    expect(result.map((c) => c.courseCode)).toEqual(['MATH1010', 'CHEM2020']);
    expect(page.waitForFunction).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('getCourses detects settled empty view and triggers debug dump', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const coursesUrl = 'https://eclass.yorku.ca/my/courses.php';
    const page = createDomPage({
      htmlByUrl: {
        [coursesUrl]: `
          <main>
            <div data-region="courses-view" data-totalcoursecount="0"></div>
            <div data-region="page-container" aria-busy="false"></div>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getCourses(session as any);

    expect(result).toEqual([]);
    expect(session.dumpPage).toHaveBeenCalledWith(page, 'dashboard_empty');
  });

  it('getCourseContent parses course index sections and external platform links', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const courseUrl = 'https://eclass.yorku.ca/course/view.php?id=303';
    const page = createDomPage({
      htmlByUrl: {
        [courseUrl]: `
          <main>
            <div class="courseindex-section">
              <div class="courseindex-section-title">
                <a class="courseindex-link">Week 1</a>
              </div>
              <div class="courseindex-item">
                <a class="courseindex-link" href="https://eclass.yorku.ca/mod/assign/view.php?id=1">Assignment 1</a>
              </div>
              <div class="courseindex-item">
                <a class="courseindex-link" href="https://eclass.yorku.ca/mod/lti/view.php?id=2&target=https://www.webassign.net/v4cgi/login.pl">WebAssign LTI</a>
              </div>
            </div>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getCourseContent(session as any, '303');

    expect(result.courseId).toBe('303');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'assign' }),
        expect.objectContaining({ name: 'WebAssign LTI', type: 'assign' }),
      ])
    );
    expect(result.external_platforms).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'cengage' })])
    );
  });

  it.skip('getCourseContent supports one-section-per-page fallback and ignores failed section loads', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const courseUrl = 'https://eclass.yorku.ca/course/view.php?id=500';
    const section1 = 'https://eclass.yorku.ca/course/view.php?id=500&section=1';
    const section2 = 'https://eclass.yorku.ca/course/view.php?id=500&section=2';

    const page = createDomPage({
      htmlByUrl: {
        [courseUrl]: `
          <main>
            <a href="/course/view.php?id=500&amp;section=1">Section 1</a>
            <a href="/course/view.php?id=500&amp;section=2">Section 2</a>
          </main>
        `,
        [section1]: `
          <main>
            <h2>Section 1</h2>
            <div class="activityinstance">
              <a href="https://eclass.yorku.ca/mod/assign/view.php?id=901">Assignment A</a>
            </div>
          </main>
        `,
        [section2]: `
          <main>
            <h2>Section 2</h2>
            <div class="activityinstance">
              <a href="https://eclass.yorku.ca/mod/url/view.php?id=902">Reading Link</a>
            </div>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getCourseContent(session as any, '500');

    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections[0]?.title).toContain('Section');
    expect(result.sections[0]?.items[0]?.type).toBe('assign');
  });

  it('getCourseContent supports section-based fallback when modules are on the main page', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const courseUrl = 'https://eclass.yorku.ca/course/view.php?id=880';
    const page = createDomPage({
      htmlByUrl: {
        [courseUrl]: `
          <main>
            <section class="section">
              <h3 class="sectionname">General</h3>
              <div class="activityinstance">
                <a href="https://eclass.yorku.ca/mod/forum/view.php?id=44">Forum Topic</a>
              </div>
              <div class="activity-item">
                <a href="https://eclass.yorku.ca/mod/url/view.php?id=55">External URL</a>
              </div>
            </section>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getCourseContent(session as any, '880');

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'announcement' }),
        expect.objectContaining({ type: 'url' }),
      ])
    );
  });

  it('getDeadlines extracts assign/quiz events and builds course metadata', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const page = createDomPage({
      htmlByUrl: {
        '*': `
          <main>
            <div class="event" data-event-id="e1" data-course-id="321">
              <h3 class="name">Assignment 1</h3>
              <div><span class="fa-clock-o"></span></div><div>May 10, 2026</div>
              <div class="card-footer">
                <a class="card-link" href="https://eclass.yorku.ca/mod/assign/view.php?id=7001">Open</a>
              </div>
              <a href="https://eclass.yorku.ca/course/view.php?id=321">MATH 1010 - Calculus I</a>
            </div>
            <div class="event" data-event-id="e2" data-course-id="321">
              <h3 class="name">Quiz 1</h3>
              <div><span class="fa-clock-o"></span></div><div>May 12, 2026</div>
              <div class="card-footer">
                <a class="card-link" href="https://eclass.yorku.ca/mod/quiz/view.php?id=7002">Open</a>
              </div>
              <a href="https://eclass.yorku.ca/course/view.php?id=321">MATH 1010 - Calculus I</a>
            </div>
            <div class="event" data-event-id="e3" data-course-id="321">
              <h3 class="name">Forum Post</h3>
              <div class="card-footer">
                <a class="card-link" href="https://eclass.yorku.ca/mod/forum/view.php?id=7003">Open</a>
              </div>
            </div>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getDeadlines(session as any, '321');

    expect(result).toHaveLength(2);
    expect(result.map((d) => d.url)).toEqual(
      expect.arrayContaining([
        'https://eclass.yorku.ca/mod/assign/view.php?id=7001',
        'https://eclass.yorku.ca/mod/quiz/view.php?id=7002',
      ])
    );
    expect(result[0]?.courseCode).toBe('MATH1010');
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining('course=321'),
      expect.objectContaining({ waitUntil: 'networkidle' })
    );
  });

  it('getMonthDeadlines selects preferred URLs and maps to deadline item types', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const page = createDomPage({
      htmlByUrl: {
        '*': `
          <main>
            <div class="calendar_event_course" data-event-id="m1" data-course-id="999">
              <a href="https://eclass.yorku.ca/mod/assign/view.php?id=1">Assignment Link</a>
              <a href="https://eclass.yorku.ca/mod/quiz/view.php?id=2">Quiz Link</a>
              <time datetime="2026-03-08T12:00:00.000Z"></time>
              <a href="https://eclass.yorku.ca/course/view.php?id=999">STAT 2000</a>
            </div>
            <div class="calendar_event" data-event-id="m2" data-course-id="999">
              <a href="https://eclass.yorku.ca/mod/quiz/view.php?id=3">Quiz 2</a>
              <time>March 9</time>
              <a href="https://eclass.yorku.ca/course/view.php?id=999">STAT 2000</a>
            </div>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getMonthDeadlines(session as any, 3, 2026, '999');

    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('assign');
    expect(result[1]?.type).toBe('quiz');
    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining('view=month'),
      expect.objectContaining({ waitUntil: 'networkidle' })
    );
  });

  it('getAssignmentIndexDeadlines maps table rows and ignores rows without assignment links', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const page = createDomPage({
      htmlByUrl: {
        '*': `
          <table class="generaltable">
            <thead>
              <tr>
                <th>Assignments</th>
                <th>Due date</th>
                <th>Section</th>
                <th>Submission</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><a href="https://eclass.yorku.ca/mod/assign/view.php?id=888">Project 1</a></td>
                <td>April 2</td>
                <td>Section A</td>
                <td>Submitted</td>
                <td>18/20</td>
              </tr>
              <tr>
                <td>No link row</td>
                <td>April 3</td>
                <td>Section B</td>
                <td>Missing</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getAssignmentIndexDeadlines(
      session as any,
      '777',
      'PHYS 2020 - Mechanics'
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: '888',
        type: 'assign',
        courseId: '777',
        courseCode: 'PHYS2020',
        section: 'Section A',
      })
    );
  });

  it('getAllAssignmentDeadlines continues when one course assignment index fails', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const coursesPage = createDomPage({
      htmlByUrl: {
        'https://eclass.yorku.ca/my/courses.php': `
          <main>
            <a href="https://eclass.yorku.ca/course/view.php?id=101">MATH 1010</a>
            <a href="https://eclass.yorku.ca/course/view.php?id=202">CHEM 2020</a>
          </main>
        `,
      },
    });

    const indexPageOk = createDomPage({
      htmlByUrl: {
        'https://eclass.yorku.ca/mod/assign/index.php?id=101': `
          <table class="generaltable">
            <thead>
              <tr><th>Assignments</th><th>Due date</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><a href="https://eclass.yorku.ca/mod/assign/view.php?id=5001">Assignment X</a></td>
                <td>May 20</td>
              </tr>
            </tbody>
          </table>
        `,
      },
    });

    const indexPageFail = {
      goto: vi.fn(async () => {
        throw new Error('simulated course load failure');
      }),
      evaluate: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => true),
      waitForSelector: vi.fn(async () => undefined),
      url: () => 'https://eclass.yorku.ca/mod/assign/index.php?id=202',
    };

    const { session } = createSessionFromPages([
      coursesPage,
      indexPageOk,
      indexPageFail,
    ]);

    const result = await getAllAssignmentDeadlines(session as any);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('5001');
  });

  it('getGrades overview mode extracts table rows and filters placeholder grades', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const page = createDomPage({
      htmlByUrl: {
        '*': `
          <table class="generaltable">
            <tr><th>Course</th><th>Grade</th></tr>
            <tr>
              <td><a href="https://eclass.yorku.ca/grade/report/user/index.php?id=11">Course A</a></td>
              <td>-</td>
            </tr>
            <tr>
              <td><a href="https://eclass.yorku.ca/grade/report/user/index.php?id=22">Course B</a></td>
              <td>87%</td>
            </tr>
          </table>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getGrades(session as any);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        courseId: '22',
        itemName: 'Course B',
        grade: '87%',
      })
    );
  });

  it('getGrades course mode parses detailed rows and drops category aggregate rows', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const page = createDomPage({
      htmlByUrl: {
        '*': `
          <table>
            <tr>
              <td class="column-itemname">Assignment Midterm</td>
              <td class="column-grade">18 / 20</td>
              <td class="column-range">0-20</td>
              <td class="column-percentage">90%</td>
              <td class="column-feedback">Great work</td>
            </tr>
            <tr>
              <td class="column-itemname">Grade item</td>
              <td class="column-grade">100%</td>
            </tr>
            <tr>
              <td class="column-itemname">Category</td>
              <td class="column-grade">-</td>
            </tr>
          </table>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getGrades(session as any, ' 55 ');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        courseId: '55',
        itemName: 'Midterm',
        grade: '18 / 20',
        percentage: '90%',
      })
    );
  });

  it('getSectionText extracts summary and tab content and classifies external links', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const targetUrl = 'https://eclass.yorku.ca/mod/page/view.php?id=321';
    const page = createDomPage({
      htmlByUrl: {
        [targetUrl]: `
          <main id="region-main">
            <h2 class="sectionname">Week 4</h2>
            <div class="summary">
              <p>Read section 4.1.</p>
              <a href="javascript:void(0)">Ignore JS link</a>
              <a href="https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-4">Launch WebAssign</a>
            </div>
            <ul class="nav-tabs">
              <li><a class="nav-link">Resources</a></li>
              <li><a class="nav-link">Practice</a></li>
            </ul>
            <div class="tab-content">
              <div class="tab-pane"><a href="https://crowdmark.com/abc">Crowdmark</a></div>
              <div class="tab-pane">No links here</div>
            </div>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getSectionText(session as any, targetUrl);

    expect(result.title).toBe('Week 4');
    expect(result.mainText).toContain('Read section 4.1');
    expect(result.mainLinks).toEqual([
      {
        name: 'Launch WebAssign',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-4',
      },
    ]);
    expect(result.tabs).toHaveLength(2);
    expect(result.external_platforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cengage' }),
        expect.objectContaining({ name: 'crowdmark' }),
      ])
    );
  });

  it('getSectionText falls back to panel titles when nav tabs are absent', async () => {
    vi.spyOn(helpers, 'checkSession').mockResolvedValue(undefined);

    const targetUrl = 'https://eclass.yorku.ca/mod/page/view.php?id=654';
    const page = createDomPage({
      htmlByUrl: {
        [targetUrl]: `
          <main role="main">
            <h3>Panel Content</h3>
            <div role="tabpanel">Panel one body</div>
            <div role="tabpanel"><a href="https://example.com/info">Info Link</a></div>
          </main>
        `,
      },
    });

    const { session } = createSessionFromPages([page]);
    const result = await getSectionText(session as any, targetUrl);

    expect(result.title).toBe('Panel Content');
    expect(result.tabs).toEqual([
      {
        title: 'Panel 1',
        content: 'Panel one body',
        links: [],
      },
      {
        title: 'Panel 2',
        content: 'Info Link',
        links: [
          {
            name: 'Info Link',
            url: 'https://example.com/info',
          },
        ],
      },
    ]);
  });
});
