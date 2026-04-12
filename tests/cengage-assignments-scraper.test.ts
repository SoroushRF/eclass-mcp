import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractAssignmentRowCandidates } from '../src/scraper/cengage/assignments';

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

  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 120,
      bottom: 24,
      width: 120,
      height: 24,
      toJSON: () => ({}) as object,
    }),
  });

  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;

  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;

  try {
    if (typeof arg === 'undefined') {
      return (callback as () => TResult)();
    }
    return (callback as (value: TArg) => TResult)(arg);
  } finally {
    restoreGlobal('window', prevWindow);
    restoreGlobal('document', prevDocument);
    restoreGlobal('HTMLElement', prevHTMLElement);
    window.close();
  }
}

describe('cengage assignment row extraction', () => {
  it('extracts assignment rows from assignment containers', async () => {
    const html = `
      <section id="js-student-myAssignmentsWrapper">
        <table>
          <tbody>
            <tr data-test="assignment_hw1" data-assignment-id="asg-101">
              <td>
                <a data-test="assignment_link_hw1" href="/assignment/101">Homework 1</a>
              </td>
              <td data-test="due">Apr 12, 2026 11:59 PM</td>
              <td data-test="score">10/10</td>
              <td data-test="status">Submitted</td>
            </tr>
          </tbody>
        </table>
      </section>
    `;

    const page = {
      evaluate: async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          'https://www.webassign.net/web/Student/Home.html',
          callback as ((value: unknown) => unknown) | (() => unknown),
          arg
        ),
    };

    const rows = await extractAssignmentRowCandidates(page as any);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: 'asg-101',
        href: '/assignment/101',
        name: 'Homework 1',
        dueDate: 'Apr 12, 2026 11:59 PM',
        score: '10/10',
        statusHint: 'Submitted',
      })
    );
  });

  it('falls back to assignment heading regions when explicit containers are missing', async () => {
    const html = `
      <main>
        <section>
          <h3>Assignments</h3>
          <ul>
            <li id="row-2">
              <a href="/assignment/202">Practice Quiz</a>
              Due Date Apr 20, 2026 Not Submitted
            </li>
          </ul>
        </section>
      </main>
    `;

    const page = {
      evaluate: async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          'https://www.webassign.net/web/Student/Home.html',
          callback as ((value: unknown) => unknown) | (() => unknown),
          arg
        ),
    };

    const rows = await extractAssignmentRowCandidates(page as any);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Practice Quiz');
    expect(rows[0]?.id).toBe('row-2');
  });
});
