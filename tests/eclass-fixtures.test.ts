import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractExternalAnnouncementLinks } from '../src/scraper/eclass/announcements';
import { isEClassAuthPage } from '../src/scraper/eclass/helpers';
import { classifyDescriptionExternalLinks } from '../src/scraper/eclass/item-details';
import { classifyExternalPlatformCandidate } from '../src/scraper/eclass/external-platforms';

const ECLASS_FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'eclass');

function readFixtureHtml(name: string): string {
  const fixturePath = path.join(ECLASS_FIXTURE_DIR, name);
  return fs.readFileSync(fixturePath, 'utf-8');
}

function extractDescriptionRawLinks(
  html: string,
  pageUrl: string
): Array<{ name: string; url: string }> {
  const dom = new JSDOM(html, { url: pageUrl });
  const document = dom.window.document;

  const descEl =
    (document.querySelector(
      '.description .no-overflow'
    ) as HTMLElement | null) ||
    (document.querySelector('#intro .no-overflow') as HTMLElement | null) ||
    (document.querySelector('#intro') as HTMLElement | null) ||
    (document.querySelector('.no-overflow') as HTMLElement | null);

  return Array.from(descEl?.querySelectorAll('a[href]') || []).map(
    (anchor) => ({
      name: (anchor.textContent || '').trim(),
      url:
        (anchor as HTMLAnchorElement).href || anchor.getAttribute('href') || '',
    })
  );
}

function extractAnnouncementRawLinks(
  html: string,
  discussionUrl: string
): Array<{ name: string; url: string }> {
  const dom = new JSDOM(html, { url: discussionUrl });
  const document = dom.window.document;

  const post = document.querySelector('.forumpost, article.forum-post');
  const body = post?.querySelector(
    '.post-content-container, .posting'
  ) as HTMLElement | null;

  return Array.from(body?.querySelectorAll('a[href]') || []).map((anchor) => ({
    name: (anchor.textContent || '').trim(),
    url: (anchor as HTMLAnchorElement).href || '',
  }));
}

function extractAuthSignalsFromHtml(html: string) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const bodyText = document.body?.textContent || '';

  return {
    title: document.title || '',
    hasPasswordInput: !!document.querySelector(
      'input[type="password"], input#password'
    ),
    hasLoginForm: !!document.querySelector(
      'form[action*="login"], form[name="loginform"], form[action*="ppylogin"]'
    ),
    hasPassportYorkMarker: bodyText.includes('Passport York Login'),
    bodyTextSnippet: bodyText.slice(0, 2000),
  };
}

describe('eclass fixture integration semantics', () => {
  it('extracts and classifies assignment description links from HTML fixture', () => {
    const pageUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=500';
    const html = readFixtureHtml('item-description.assignment.html');
    const rawLinks = extractDescriptionRawLinks(html, pageUrl);

    const links = classifyDescriptionExternalLinks(rawLinks, pageUrl);

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

  it('uses URL fallback for relative LTI anchors in description HTML fixture', () => {
    const pageUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=12';
    const html = readFixtureHtml('item-description.relative-lti.html');
    const rawLinks = extractDescriptionRawLinks(html, pageUrl);

    const links = classifyDescriptionExternalLinks(rawLinks, pageUrl);

    expect(links).toEqual([
      {
        name: 'https://eclass.yorku.ca/mod/lti/view.php?id=8888',
        url: 'https://eclass.yorku.ca/mod/lti/view.php?id=8888',
        linkType: 'eclass_lti',
      },
    ]);
  });

  it('extracts and dedupes external announcement links from discussion HTML fixture', () => {
    const discussionUrl = 'https://eclass.yorku.ca/mod/forum/discuss.php?d=700';
    const html = readFixtureHtml('announcements.discussion.html');
    const rawLinks = extractAnnouncementRawLinks(html, discussionUrl);

    const links = extractExternalAnnouncementLinks(rawLinks, discussionUrl);

    expect(links).toEqual([
      {
        name: 'Launch WebAssign',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-700',
        sourceDiscussionUrl: discussionUrl,
      },
      {
        name: 'Cengage dashboard',
        url: 'https://www.cengage.com/dashboard/home',
        sourceDiscussionUrl: discussionUrl,
      },
    ]);
  });

  it('classifies external platform candidates from activity HTML fixture', () => {
    const html = readFixtureHtml('external-platform.activities.html');
    const pageUrl = 'https://eclass.yorku.ca/course/view.php?id=321';
    const dom = new JSDOM(html, { url: pageUrl });
    const document = dom.window.document;

    const candidates = Array.from(
      document.querySelectorAll('#activities li')
    ).map((item) => {
      const anchor = item.querySelector('a[href]') as HTMLAnchorElement | null;
      return {
        name: (anchor?.textContent || '').trim(),
        url: anchor?.href || '',
        itemType: (item as HTMLElement).dataset.itemType || '',
      };
    });

    const matches = candidates
      .map((candidate) => classifyExternalPlatformCandidate(candidate))
      .filter((value): value is NonNullable<typeof value> => value !== null);

    expect(matches).toEqual([
      {
        name: 'cengage',
        url: 'https://eclass.yorku.ca/mod/lti/view.php?id=12345',
        signal: 'lti',
      },
      {
        name: 'cengage',
        url: 'https://eclass.yorku.ca/mod/url/view.php?id=33333',
        signal: 'url_activity',
      },
      {
        name: 'cengage',
        url: 'https://eclass.yorku.ca/mod/resource/view.php?id=44444',
        signal: 'resource_activity',
      },
    ]);
  });

  it('marks Passport York login fixture as an auth page', () => {
    const html = readFixtureHtml('auth.passport-login.html');
    const signals = extractAuthSignalsFromHtml(html);

    expect(
      isEClassAuthPage({
        url: 'https://eclass.yorku.ca/my/courses.php',
        ...signals,
      })
    ).toBe(true);
  });

  it('does not over-trigger on quiz password fixture', () => {
    const html = readFixtureHtml('auth.quiz-password.html');
    const signals = extractAuthSignalsFromHtml(html);

    expect(
      isEClassAuthPage({
        url: 'https://eclass.yorku.ca/mod/quiz/view.php?id=123',
        ...signals,
      })
    ).toBe(false);
  });
});
