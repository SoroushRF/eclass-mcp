import { describe, expect, it } from 'vitest';
import { classifyDescriptionExternalLinks } from '../src/scraper/eclass/item-details';

describe('item description external link extraction', () => {
  it('extracts and classifies webassign/cengage links from description anchors', () => {
    const pageUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=500';

    const links = classifyDescriptionExternalLinks(
      [
        {
          name: 'Launch WebAssign',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-500#start',
        },
        {
          name: 'Cengage dashboard',
          url: 'https://www.cengage.com/dashboard/home',
        },
        {
          name: 'Internal forum',
          url: 'https://eclass.yorku.ca/mod/forum/discuss.php?d=999',
        },
        {
          name: 'LTI launch',
          url: 'https://eclass.yorku.ca/mod/lti/view.php?id=12345',
        },
        {
          name: 'Duplicate WebAssign',
          url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-500',
        },
      ],
      pageUrl
    );

    expect(links).toEqual([
      {
        name: 'Launch WebAssign',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-500',
        linkType: 'webassign_course',
      },
      {
        name: 'Cengage dashboard',
        url: 'https://www.cengage.com/dashboard/home',
        linkType: 'cengage_dashboard',
      },
      {
        name: 'LTI launch',
        url: 'https://eclass.yorku.ca/mod/lti/view.php?id=12345',
        linkType: 'eclass_lti',
      },
    ]);
  });

  it('keeps unknown external links with other classification', () => {
    const links = classifyDescriptionExternalLinks(
      [
        {
          name: 'External reading',
          url: 'https://example.org/assignment-notes',
        },
      ],
      'https://eclass.yorku.ca/mod/quiz/view.php?id=42'
    );

    expect(links).toEqual([
      {
        name: 'External reading',
        url: 'https://example.org/assignment-notes',
        linkType: 'other',
      },
    ]);
  });

  it('supports relative LTI links and fallback text', () => {
    const links = classifyDescriptionExternalLinks(
      [
        {
          name: '   ',
          url: '/mod/lti/view.php?id=8888',
        },
      ],
      'https://eclass.yorku.ca/mod/assign/view.php?id=12'
    );

    expect(links).toEqual([
      {
        name: 'https://eclass.yorku.ca/mod/lti/view.php?id=8888',
        url: 'https://eclass.yorku.ca/mod/lti/view.php?id=8888',
        linkType: 'eclass_lti',
      },
    ]);
  });
});
