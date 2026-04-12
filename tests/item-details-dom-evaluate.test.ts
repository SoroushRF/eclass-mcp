import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  classifyDescriptionExternalLinks,
  getAssignmentDetails,
  getQuizDetails,
} from '../src/scraper/eclass/item-details';

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
  callback: ((arg: TArg) => TResult) | ((arg: string) => TResult),
  arg: TArg,
  setup?: (window: Window) => void
): TResult {
  const dom = new JSDOM(html, { url });
  const { window } = dom;

  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      return (this.textContent || '').replace(/\s+/g, ' ').trim();
    },
  });

  setup?.(window as unknown as Window);

  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;

  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;

  try {
    return callback(arg as any);
  } finally {
    restoreGlobal('window', prevWindow);
    restoreGlobal('document', prevDocument);
    restoreGlobal('HTMLElement', prevHTMLElement);
    window.close();
  }
}

describe('eclass item-details DOM extraction branches', () => {
  it('extracts assignment details with attachment filtering, dedupe, and feedback normalization', async () => {
    const assignmentUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=5010';

    const html = `
      <main>
        <h1>Assignment Deep Dive</h1>
        <div class="description">
          <div class="no-overflow" id="desc">
            <p>Read this before submitting.</p>
            <a href="https://eclass.yorku.ca/mod/forum/view.php?id=10">Forum</a>
            <a href="/mod/lti/view.php?id=55">LTI launch</a>
            <a href="https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-1#frag">WebAssign launch</a>
            <img src="/pluginfile.php/1/image.png" />
          </div>
        </div>

        <a href="/pluginfile.php/1/image.png">duplicate image</a>
        <a href="/pluginfile.php/1/grades.csv">grades.csv</a>
        <a href="/pluginfile.php/1/grades.csv">grades.csv</a>

        <table class="submissionstatustable">
          <tr><th>Grade</th><td>15 / 20</td></tr>
          <tr>
            <th>Submission comments</th>
            <td>
              <div class="comment-message">Great work</div>
              <div class="comment-message">___</div>
            </td>
          </tr>
          <tr><th>Feedback comments</th><td>Great work</td></tr>
        </table>

        <div class="assignfeedback_comments">Great work</div>
      </main>
    `;

    const commentClick = vi.fn().mockRejectedValue(new Error('ignore click'));
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue({ click: commentClick }),
      waitForTimeout: vi
        .fn()
        .mockRejectedValue(new Error('ignore wait timeout')),
      evaluate: vi.fn(async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          assignmentUrl,
          callback as (value: unknown) => unknown,
          arg,
          (window) => {
            (window as any).M = { cfg: { courseId: '777' } };
          }
        )
      ),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn().mockResolvedValue(context),
    };

    const result = await getAssignmentDetails(session as any, assignmentUrl);

    expect(result.kind).toBe('assign');
    expect(result.courseId).toBe('777');
    expect(result.title).toBe('Assignment Deep Dive');
    expect(result.descriptionImageUrls).toEqual([
      'https://eclass.yorku.ca/pluginfile.php/1/image.png',
    ]);
    expect(result.attachments).toEqual([
      expect.objectContaining({
        url: 'https://eclass.yorku.ca/pluginfile.php/1/grades.csv',
        kind: 'csv',
      }),
    ]);
    expect(result.grade).toBe('15 / 20');
    expect(result.feedbackText).toBe('Great work');
    expect(result.externalLinks).toEqual([
      {
        name: 'LTI launch',
        url: 'https://eclass.yorku.ca/mod/lti/view.php?id=55',
        linkType: 'eclass_lti',
      },
      {
        name: 'WebAssign launch',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-1',
        linkType: 'webassign_course',
      },
    ]);

    expect(page.$).toHaveBeenCalledWith('.comment-link');
    expect(commentClick).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).toHaveBeenCalledWith(1000);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('extracts quiz details using highest-grade parsing and attachment dedupe', async () => {
    const quizUrl = 'https://eclass.yorku.ca/mod/quiz/view.php?id=9001';
    const html = `
      <main>
        <div id="intro">
          <div class="no-overflow">
            <a href="https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-77">WebAssign</a>
            <img src="/pluginfile.php/2/qimg.jpg" />
          </div>
        </div>
        <a href="/pluginfile.php/2/qimg.jpg">duplicate image link</a>
        <a href="/pluginfile.php/2/slides.pptx">Slides</a>
        <a href="/pluginfile.php/2/slides.pptx">Slides</a>

        <div>Highest grade: 8 / 10</div>
        <table class="quizattemptsummary">
          <tr><th>State</th><td>Finished</td></tr>
          <tr><th>Grade</th><td>8 / 10</td></tr>
        </table>
      </main>
    `;

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          quizUrl,
          callback as (value: unknown) => unknown,
          arg,
          (window) => {
            window.document.body.className = 'course-123';
          }
        )
      ),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn().mockResolvedValue(context),
    };

    const result = await getQuizDetails(session as any, quizUrl);

    expect(result.kind).toBe('quiz');
    expect(result.courseId).toBe('123');
    expect(result.grade).toBe('8 / 10');
    expect(result.fields).toEqual(
      expect.objectContaining({
        State: 'Finished',
        Grade: '8 / 10',
      })
    );
    expect(result.attachments).toEqual([
      expect.objectContaining({
        url: 'https://eclass.yorku.ca/pluginfile.php/2/slides.pptx',
        kind: 'pptx',
      }),
    ]);
    expect(result.externalLinks).toEqual([
      {
        name: 'WebAssign',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-77',
        linkType: 'webassign_course',
      },
    ]);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('extracts quiz grade via grade-to-pass fallback when no score is present', async () => {
    const quizUrl = 'https://eclass.yorku.ca/mod/quiz/view.php?id=9010';
    const html = `
      <main>
        <div id="intro"><div class="no-overflow">Read all instructions.</div></div>
        <p>Grade to pass: 5 out of 10</p>
        <p>Feedback: Read rubric carefully</p>
      </main>
    `;

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          quizUrl,
          callback as (value: unknown) => unknown,
          arg
        )
      ),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn().mockResolvedValue(context),
    };

    const result = await getQuizDetails(session as any, quizUrl);

    expect(result.kind).toBe('quiz');
    expect(result.grade).toBe('5 / 10 (to pass)');
    expect(result.feedbackText).toContain('Read rubric carefully');
    expect(result.fields).toBeUndefined();
  });

  it('classifies external links while dropping unsafe or duplicate links', () => {
    const links = classifyDescriptionExternalLinks(
      [
        { name: ' ', url: '' },
        { name: 'JS', url: 'javascript:alert(1)' },
        { name: 'FTP', url: 'ftp://example.com/file' },
        {
          name: 'Forum',
          url: 'https://eclass.yorku.ca/mod/forum/view.php?id=10',
        },
        { name: 'LTI', url: '/mod/lti/view.php?id=99' },
        {
          name: 'WebAssign',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-2',
        },
        {
          name: 'duplicate webassign',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-2#section',
        },
      ],
      'https://eclass.yorku.ca/mod/assign/view.php?id=123'
    );

    expect(links).toEqual([
      {
        name: 'LTI',
        url: 'https://eclass.yorku.ca/mod/lti/view.php?id=99',
        linkType: 'eclass_lti',
      },
      {
        name: 'WebAssign',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-prod-2',
        linkType: 'webassign_course',
      },
    ]);
  });
});
