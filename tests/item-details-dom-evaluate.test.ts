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

  it('extracts assignment fallback selectors, cleaned comments, body course id, and attachment kinds', async () => {
    const assignmentUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=7777';
    const html = `
      <main>
        <h1>Fallback Assignment</h1>
        <div id="intro">
          <div class="no-overflow">
            <p>Fallback intro text.</p>
          </div>
        </div>
        <a href="/pluginfile.php/7/spec.pdf">Spec</a>
        <a href="/pluginfile.php/7/template.docx">Template</a>
        <a href="/pluginfile.php/7/archive.zip">Archive</a>
        <table class="generaltable">
          <tr><th>Grading status</th><td>Not graded</td></tr>
          <tr><th>Submission comments</th><td>Show comments Comments (1) Needs more detail Save comment | Cancel</td></tr>
          <tr><th>Feedback</th><td>Inline feedback</td></tr>
        </table>
      </main>
    `;

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn(async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          assignmentUrl,
          callback as (value: unknown) => unknown,
          arg,
          (window) => {
            window.document.body.className = 'format-topics course-456';
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

    expect(result.courseId).toBe('456');
    expect(result.descriptionText).toContain('Fallback intro text');
    expect(result.grade).toBe('Not graded');
    expect(result.feedbackText).toContain('Needs more detail');
    expect(result.feedbackText).toContain('Inline feedback');
    expect(result.attachments?.map((attachment) => attachment.kind)).toEqual([
      'pdf',
      'docx',
      'other',
    ]);
  });

  it('handles a minimal assignment page without intro, status table, course id, or external links', async () => {
    const assignmentUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=8888';
    const html = `
      <html>
        <head><title>Minimal Assignment From Title</title></head>
        <body>
          <main>
            <p>No Moodle intro block was rendered for this activity.</p>
          </main>
        </body>
      </html>
    `;

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn(async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          assignmentUrl,
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

    const result = await getAssignmentDetails(session as any, assignmentUrl);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'assign',
        url: assignmentUrl,
        title: 'Minimal Assignment From Title',
      })
    );
    expect(result.courseId).toBeUndefined();
    expect(result.descriptionText).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.externalLinks).toBeUndefined();
    expect(page.$).toHaveBeenCalledWith('.comment-link');
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('limits assignment attachments at twenty and preserves unnamed plugin files', async () => {
    const assignmentUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=9999';
    const anchors = Array.from({ length: 25 }, (_, index) => {
      const label = index === 0 ? '' : `File ${index}`;
      return `<a href="/pluginfile.php/9/file-${index}.pdf">${label}</a>`;
    }).join('\n');
    const html = `
      <main>
        <h1>Attachment Limit Assignment</h1>
        <div id="intro"><div class="no-overflow">Review the package.</div></div>
        ${anchors}
      </main>
    `;

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn(async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          assignmentUrl,
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

    const result = await getAssignmentDetails(session as any, assignmentUrl);

    expect(result.attachments).toHaveLength(20);
    expect(result.attachments?.[0]).toEqual(
      expect.objectContaining({
        url: 'https://eclass.yorku.ca/pluginfile.php/9/file-0.pdf',
        kind: 'pdf',
      })
    );
    expect(result.attachments?.[0].name).toBeUndefined();
    expect(result.attachments?.[19]?.url).toBe(
      'https://eclass.yorku.ca/pluginfile.php/9/file-19.pdf'
    );
  });

  it('extracts quiz mark percent and fields from a nested summary table container', async () => {
    const quizUrl = 'https://eclass.yorku.ca/mod/quiz/view.php?id=9020';
    const html = `
      <main>
        <h1>Nested Quiz Summary</h1>
        <section id="intro"><div class="no-overflow">Quiz description text.</div></section>
        <p>Mark: 87.5%</p>
        <div class="quizattemptsummary">
          <table>
            <tr><th>Attempt state</th><td>Submitted</td></tr>
            <tr><th>Final mark</th><td>87.5%</td></tr>
          </table>
        </div>
        <a href="/pluginfile.php/3/chart.png?preview=1">Chart</a>
        <a href="/pluginfile.php/3/data.csv">Data</a>
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

    expect(result.grade).toBe('87.5%');
    expect(result.fields).toEqual({
      'Attempt state': 'Submitted',
      'Final mark': '87.5%',
    });
    expect(result.descriptionText).toBe('Quiz description text.');
    expect(result.attachments?.map((attachment) => attachment.kind)).toEqual([
      'image',
      'csv',
    ]);
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
