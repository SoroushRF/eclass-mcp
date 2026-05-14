import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
}));

vi.mock('../src/scraper/eclass/browser-session', () => ({
  ECLASS_URL: 'https://eclass.yorku.ca',
}));

vi.mock('../src/scraper/eclass/helpers', () => ({
  checkSession: mocks.checkSession,
}));

import {
  extractExternalAnnouncementLinks,
  getAnnouncements,
} from '../src/scraper/eclass/announcements';

function makeSession(evaluateResults: Array<unknown | (() => unknown)>) {
  const evaluate = vi.fn(async () => {
    const next = evaluateResults.shift();
    if (typeof next === 'function') return next();
    return next;
  });
  const page = {
    goto: vi.fn(async () => undefined),
    evaluate,
    close: vi.fn(async () => undefined),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  return {
    session: {
      getAuthenticatedContext: vi.fn(async () => context),
    },
    page,
    context,
  };
}

describe('eClass announcements scraper flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts only unique external announcement links', () => {
    const links = extractExternalAnnouncementLinks(
      [
        { name: 'Zoom', url: 'https://zoom.us/j/123#fragment' },
        { name: 'Zoom duplicate', url: 'https://zoom.us/j/123' },
        {
          name: 'Internal',
          url: 'https://eclass.yorku.ca/mod/resource/view.php?id=1',
        },
        { name: '', url: 'notaurl' },
        { name: '', url: 'https://example.com/doc' },
      ],
      'https://eclass.yorku.ca/mod/forum/discuss.php?d=1'
    );

    expect(links).toEqual([
      {
        name: 'Zoom',
        url: 'https://zoom.us/j/123',
        sourceDiscussionUrl:
          'https://eclass.yorku.ca/mod/forum/discuss.php?d=1',
      },
      {
        name: 'https://example.com/doc',
        url: 'https://example.com/doc',
        sourceDiscussionUrl:
          'https://eclass.yorku.ca/mod/forum/discuss.php?d=1',
      },
    ]);
  });

  it('falls back from forum index to course page and returns empty when no forum link exists', async () => {
    const { session, page, context } = makeSession(['', '']);

    const result = await getAnnouncements(session as any, '143648');

    expect(result).toEqual([]);
    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      'https://eclass.yorku.ca/mod/forum/index.php?id=143648',
      expect.any(Object)
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      'https://eclass.yorku.ca/course/view.php?id=143648',
      expect.any(Object)
    );
    expect(page.close).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  it('deduplicates discussions and fetches content with external links', async () => {
    const { session, page } = makeSession([
      'https://eclass.yorku.ca/mod/forum/view.php?id=10',
      [
        {
          id: '1',
          title: 'Old shell',
          discussionUrl: 'https://eclass.yorku.ca/mod/forum/discuss.php?d=1',
          date: '',
          author: '',
        },
        {
          id: '1',
          title: 'Richer shell',
          discussionUrl: 'https://eclass.yorku.ca/mod/forum/discuss.php?d=1',
          date: 'May 1',
          author: 'Prof',
        },
        {
          id: '2',
          title: 'Second',
          discussionUrl: 'https://eclass.yorku.ca/mod/forum/discuss.php?d=2',
          date: 'May 2',
          author: '',
        },
      ],
      {
        content: 'Read chapter 1',
        links: [
          { name: 'External PDF', url: 'https://example.com/a.pdf' },
          {
            name: 'Internal',
            url: 'https://eclass.yorku.ca/mod/resource/view.php?id=2',
          },
        ],
      },
      () => {
        throw new Error('discussion failed');
      },
    ]);

    const result = await getAnnouncements(session as any, '143648', 2);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: '1',
      title: 'Richer shell',
      content: 'Read chapter 1',
      date: 'May 1',
      author: 'Prof',
    });
    expect(result[0].links).toEqual([
      expect.objectContaining({
        name: 'External PDF',
        url: 'https://example.com/a.pdf',
      }),
    ]);
    expect(result[1]).toMatchObject({
      id: '2',
      content: 'Could not fetch content.',
    });
    expect(page.goto).toHaveBeenCalledWith(
      'https://eclass.yorku.ca/mod/forum/discuss.php?d=2',
      expect.any(Object)
    );
  });

  it('uses the dashboard announcements route when no course is specified', async () => {
    const { session, page } = makeSession([[]]);

    const result = await getAnnouncements(session as any);

    expect(result).toEqual([]);
    expect(page.goto).toHaveBeenCalledWith(
      'https://eclass.yorku.ca/my/',
      expect.any(Object)
    );
  });
});
