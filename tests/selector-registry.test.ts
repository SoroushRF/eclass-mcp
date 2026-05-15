import fs from 'fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrapeLayoutError } from '../src/scraper/scrape-errors';
import {
  collectSelectorCounts,
  findFirstAttached,
  findFirstVisible,
  queryAllFromFirstWinningGroup,
  queryFirstFromGroup,
  selectorsFor,
  throwSelectorLayoutChanged,
  waitForAnySelector,
} from '../src/scraper/selectors';

const originalSnapshotEnv = process.env.ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS;

afterEach(() => {
  if (originalSnapshotEnv === undefined) {
    delete process.env.ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS;
  } else {
    process.env.ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS = originalSnapshotEnv;
  }
});

function dom(html: string): Document {
  return new JSDOM(html).window.document;
}

function fakePage(
  counts: Record<string, number>,
  visible: Record<string, boolean> = {}
) {
  return {
    url: () => 'https://example.invalid/course',
    title: async () => 'Fixture Page',
    content: async () => '<html><body>fixture</body></html>',
    waitForTimeout: async () => undefined,
    locator: (selector: string) => ({
      first: () => ({
        count: async () => counts[selector] || 0,
        isVisible: async () =>
          Object.prototype.hasOwnProperty.call(visible, selector)
            ? visible[selector]
            : (counts[selector] || 0) > 0,
      }),
      count: async () => counts[selector] || 0,
    }),
  };
}

describe('selector registry DOM helpers', () => {
  it('returns the first matching selector by registry priority', () => {
    const document = dom(`
      <a class="course_title" href="/course/view.php?id=2">Second</a>
      <div class="course-listitem"><a class="coursename">First</a></div>
    `);
    const candidates = [
      { id: 'first', selector: '.course-listitem .coursename' },
      { id: 'second', selector: '.course_title' },
    ];

    const match = queryFirstFromGroup(document, candidates);

    expect(match?.candidateId).toBe('first');
    expect(match?.count).toBe(1);
    expect(match?.element.textContent).toBe('First');
  });

  it('collects selector counts without selecting a winner', () => {
    const document = dom(`
      <div class="event"></div>
      <div class="event"></div>
      <div class="calendar_event"></div>
    `);
    const candidates = [
      { id: 'calendar_event', selector: '.calendar_event' },
      { id: 'event', selector: '.event' },
    ];

    expect(collectSelectorCounts(document, candidates)).toEqual({
      '.calendar_event': 1,
      '.event': 2,
    });
  });

  it('returns all elements from the first winning selector only', () => {
    const document = dom(`
      <div class="topic">A</div>
      <div class="topic">B</div>
      <div class="discussion">C</div>
    `);
    const candidates = [
      { id: 'topic', selector: '.topic' },
      { id: 'discussion', selector: '.discussion' },
    ];

    const match = queryAllFromFirstWinningGroup(document, candidates);

    expect(match?.candidateId).toBe('topic');
    expect(match?.elements.map((el) => el.textContent)).toEqual(['A', 'B']);
  });
});

describe('selector registry Playwright helpers', () => {
  it('returns the first attached Playwright selector by registry priority', async () => {
    const match = await findFirstAttached(
      fakePage({
        '.course-listitem .coursename': 0,
        '.coursebox .coursename a': 2,
      }) as any,
      'eclass.dashboard.course_cards'
    );

    expect(match?.candidateId).toBe('legacy_coursebox');
    expect(match?.matchCount).toBe(2);
  });

  it('skips attached but hidden selectors when visible matching is required', async () => {
    const match = await findFirstVisible(
      fakePage(
        {
          '.course-listitem .coursename': 1,
          '.coursebox .coursename a': 2,
        },
        {
          '.course-listitem .coursename': false,
          '.coursebox .coursename a': true,
        }
      ) as any,
      'eclass.dashboard.course_cards'
    );

    expect(match?.candidateId).toBe('legacy_coursebox');
    expect(match?.selector).toBe('.coursebox .coursename a');
  });

  it('waits until any selector in the group appears', async () => {
    let attempts = 0;
    const page = fakePage({}) as any;
    page.locator = (selector: string) => ({
      first: () => ({
        count: async () => 0,
        isVisible: async () => true,
      }),
      count: async () => {
        attempts += 1;
        return attempts >= 2 && selector === '.course-listitem .coursename'
          ? 1
          : 0;
      },
    });

    const match = await waitForAnySelector(
      page,
      'eclass.dashboard.course_cards',
      { timeoutMs: 100 }
    );

    expect(match?.candidateId).toBe('moove_course_listitem');
  });

  it('returns null for optional selector lookup failures', async () => {
    const match = await findFirstAttached(
      fakePage({}) as any,
      'eclass.dashboard.course_cards',
      { required: false }
    );

    expect(match).toBeNull();
  });

  it('throws SCRAPE_LAYOUT_CHANGED with selector diagnostics on required failure', async () => {
    await expect(
      findFirstAttached(fakePage({}) as any, 'eclass.dashboard.course_cards')
    ).rejects.toMatchObject({
      code: 'SCRAPE_LAYOUT_CHANGED',
      context: {
        groupId: 'eclass.dashboard.course_cards',
        pageType: 'eclass.dashboard',
        triedSelectors: expect.arrayContaining([
          '.course-listitem .coursename',
        ]),
        selectorCounts: expect.objectContaining({
          '.course-listitem .coursename': 0,
        }),
        url: 'https://example.invalid/course',
        title: 'Fixture Page',
      },
    });
  });

  it('does not write selector snapshots unless explicitly enabled', async () => {
    delete process.env.ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS;

    try {
      await throwSelectorLayoutChanged(
        fakePage({}) as any,
        'eclass.files.direct_download_link'
      );
      throw new Error('expected selector failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ScrapeLayoutError);
      expect(
        (error as ScrapeLayoutError).context?.snapshotPath
      ).toBeUndefined();
    }
  });

  it('writes bounded selector snapshots when enabled', async () => {
    process.env.ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS = '1';

    try {
      await throwSelectorLayoutChanged(
        fakePage({}) as any,
        'eclass.files.direct_download_link'
      );
      throw new Error('expected selector failure');
    } catch (error) {
      const snapshotPath = (error as ScrapeLayoutError).context
        ?.snapshotPath as string | undefined;
      expect(snapshotPath).toBeTruthy();
      expect(fs.existsSync(snapshotPath as string)).toBe(true);
      fs.rmSync(snapshotPath as string, { force: true });
      fs.rmSync((snapshotPath as string).replace(/\.html$/, '.json'), {
        force: true,
      });
    }
  });

  it('keeps the original selector failure when snapshot writing fails', async () => {
    process.env.ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS = '1';
    const page = {
      ...fakePage({}),
      content: async () => {
        throw new Error('cannot serialize page');
      },
    };

    try {
      await throwSelectorLayoutChanged(
        page as any,
        'eclass.files.direct_download_link'
      );
      throw new Error('expected selector failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ScrapeLayoutError);
      expect((error as ScrapeLayoutError).code).toBe('SCRAPE_LAYOUT_CHANGED');
      expect(
        (error as ScrapeLayoutError).context?.snapshotPath
      ).toBeUndefined();
    }
  });
});

describe('required selector groups', () => {
  it('exposes stable Cengage assignment selectors through the registry', () => {
    expect(selectorsFor('cengage.assignments.containers')).toContain(
      '#js-student-myAssignmentsWrapper'
    );
    expect(selectorsFor('cengage.assignments.rows')).toContain(
      '[data-assignment-id]'
    );
  });
});
