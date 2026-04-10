import { describe, expect, it } from 'vitest';
import { extractExternalAnnouncementLinks } from '../src/scraper/eclass/announcements';

describe('announcement link extraction', () => {
  it('keeps external links, adds traceability, and dedupes normalized URLs', () => {
    const sourceDiscussionUrl =
      'https://eclass.yorku.ca/mod/forum/discuss.php?d=4242';

    const links = extractExternalAnnouncementLinks(
      [
        {
          name: 'Launch WebAssign',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001#top',
        },
        {
          name: 'Duplicate launch link',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
        },
        {
          name: 'Cengage dashboard',
          url: 'https://www.cengage.com/dashboard/home',
        },
      ],
      sourceDiscussionUrl
    );

    expect(links).toEqual([
      {
        name: 'Launch WebAssign',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
        sourceDiscussionUrl,
      },
      {
        name: 'Cengage dashboard',
        url: 'https://www.cengage.com/dashboard/home',
        sourceDiscussionUrl,
      },
    ]);
  });

  it('filters out internal, invalid, and non-http links', () => {
    const links = extractExternalAnnouncementLinks(
      [
        {
          name: 'Internal forum link',
          url: 'https://eclass.yorku.ca/mod/forum/discuss.php?d=111',
        },
        { name: 'Mailto', url: 'mailto:instructor@yorku.ca' },
        { name: 'Broken', url: 'not-a-url' },
      ],
      'https://eclass.yorku.ca/mod/forum/discuss.php?d=111'
    );

    expect(links).toEqual([]);
  });

  it('uses URL as fallback link text when anchor text is empty', () => {
    const sourceDiscussionUrl =
      'https://eclass.yorku.ca/mod/forum/discuss.php?d=5151';

    const links = extractExternalAnnouncementLinks(
      [
        {
          name: '   ',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-5151',
        },
      ],
      sourceDiscussionUrl
    );

    expect(links).toEqual([
      {
        name: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-5151',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-5151',
        sourceDiscussionUrl,
      },
    ]);
  });
});
