import type { EClassBrowserSession } from './browser-session';
import { ECLASS_URL } from './browser-session';
import { checkSession } from './helpers';
import type { Announcement } from './types';
import { getSelectorGroup, logDomSelectorMatch } from '../selectors';

const GOTO_OPTS = {
  waitUntil: 'domcontentloaded' as const,
  timeout: 30000,
};

const ECLASS_HOST = new URL(ECLASS_URL).host.toLowerCase();

function normalizeAnnouncementLinkUrl(url: string): string {
  return (url || '').trim().replace(/#.*$/, '');
}

function isExternalHttpUrl(url: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return parsed.host.toLowerCase() !== ECLASS_HOST;
  } catch {
    return false;
  }
}

export function extractExternalAnnouncementLinks(
  rawLinks: Array<{ name: string; url: string }>,
  sourceDiscussionUrl: string
): Announcement['links'] {
  const seen = new Set<string>();
  const links: Announcement['links'] = [];

  for (const raw of rawLinks) {
    const normalizedUrl = normalizeAnnouncementLinkUrl(raw.url);
    if (!isExternalHttpUrl(normalizedUrl)) {
      continue;
    }

    const key = normalizedUrl.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const name = (raw.name || '').trim() || normalizedUrl;
    links.push({
      name,
      url: normalizedUrl,
      sourceDiscussionUrl,
    });
  }

  return links;
}

export async function getAnnouncements(
  session: EClassBrowserSession,
  courseId?: string,
  limit: number = 10
): Promise<Announcement[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    const cid = courseId?.trim();
    let forumUrl = '';

    if (cid) {
      await page.goto(`${ECLASS_URL}/mod/forum/index.php?id=${cid}`, GOTO_OPTS);
      await checkSession(page);

      const forumSelectors = [
        ...getSelectorGroup('eclass.announcements.forum_link').candidates,
      ];
      const forumResult = await page.evaluate((selectors) => {
        let links: HTMLAnchorElement[] = [];
        let selectorMatch:
          | { candidateId: string; selector: string; count: number }
          | undefined;
        for (const candidate of selectors) {
          const found = Array.from(
            document.querySelectorAll<HTMLAnchorElement>(candidate.selector)
          );
          if (found.length > 0) {
            links = found;
            selectorMatch = {
              candidateId: candidate.id,
              selector: candidate.selector,
              count: found.length,
            };
            break;
          }
        }
        const target =
          links.find((l) =>
            /announcement|news|forum/i.test(l.textContent || '')
          ) || links[0];
        return { forumUrl: target ? target.href : '', selectorMatch };
      }, forumSelectors);
      forumUrl =
        typeof forumResult === 'string' ? forumResult : forumResult.forumUrl;
      if (typeof forumResult !== 'string' && forumResult.selectorMatch) {
        logDomSelectorMatch({
          pageType: 'eclass.announcements',
          groupId: 'eclass.announcements.forum_link',
          candidateId: forumResult.selectorMatch.candidateId,
          selector: forumResult.selectorMatch.selector,
          matchCount: forumResult.selectorMatch.count,
          url: typeof page.url === 'function' ? page.url() : undefined,
        });
      }

      if (!forumUrl) {
        forumUrl = `${ECLASS_URL}/course/view.php?id=${cid}`;
      }
    } else {
      forumUrl = `${ECLASS_URL}/my/`;
    }

    await page.goto(forumUrl, GOTO_OPTS);
    await checkSession(page);

    if (forumUrl.includes('course/view')) {
      const forumSelectors = [
        ...getSelectorGroup('eclass.announcements.forum_link').candidates,
      ];
      const foundLinkResult = await page.evaluate((selectors) => {
        let links: HTMLAnchorElement[] = [];
        let selectorMatch:
          | { candidateId: string; selector: string; count: number }
          | undefined;
        for (const candidate of selectors) {
          const found = Array.from(
            document.querySelectorAll<HTMLAnchorElement>(candidate.selector)
          );
          if (found.length > 0) {
            links = found;
            selectorMatch = {
              candidateId: candidate.id,
              selector: candidate.selector,
              count: found.length,
            };
            break;
          }
        }
        const target =
          links.find((l) =>
            /announcement|news|forum/i.test(l.textContent || '')
          ) || links[0];
        return { href: target?.href || '', selectorMatch };
      }, forumSelectors);
      const foundLink =
        typeof foundLinkResult === 'string'
          ? foundLinkResult
          : foundLinkResult.href;
      if (
        typeof foundLinkResult !== 'string' &&
        foundLinkResult.selectorMatch
      ) {
        logDomSelectorMatch({
          pageType: 'eclass.announcements',
          groupId: 'eclass.announcements.forum_link',
          candidateId: foundLinkResult.selectorMatch.candidateId,
          selector: foundLinkResult.selectorMatch.selector,
          matchCount: foundLinkResult.selectorMatch.count,
          url: typeof page.url === 'function' ? page.url() : undefined,
        });
      }
      if (foundLink) {
        await page.goto(foundLink, GOTO_OPTS);
      } else {
        return [];
      }
    }

    const topicSelectors = [
      ...getSelectorGroup('eclass.announcements.topic_rows').candidates,
    ];
    const announcementsResult = await page.evaluate((selectors) => {
      let topics: Element[] = [];
      let selectorMatch:
        | { candidateId: string; selector: string; count: number }
        | undefined;
      for (const candidate of selectors) {
        const found = Array.from(document.querySelectorAll(candidate.selector));
        if (found.length > 0) {
          topics = found;
          selectorMatch = {
            candidateId: candidate.id,
            selector: candidate.selector,
            count: found.length,
          };
          break;
        }
      }
      const announcements = topics
        .map((row) => {
          const titleLink = row.querySelector(
            '.subject a, .topic-name a, th.topic a'
          ) as HTMLAnchorElement;

          let authorText =
            row.querySelector('.author')?.textContent?.trim() || '';
          if (!authorText) {
            const authorDiv = row.querySelectorAll(
              '.author-info .text-truncate'
            );
            if (authorDiv.length > 0)
              authorText = authorDiv[0].textContent?.trim() || '';
          }

          let dateText =
            row
              .querySelector('.lastpost date, .modified')
              ?.textContent?.trim() || '';
          if (!dateText) {
            const times = row.querySelectorAll('time');
            if (times.length > 0) dateText = times[0].textContent?.trim() || '';
          }

          return {
            id: titleLink?.href.match(/[?&]d=(\d+)/)?.[1] || '',
            title: titleLink?.textContent?.trim() || 'Untitled',
            discussionUrl: titleLink?.href || '',
            date: dateText,
            author: authorText,
          };
        })
        .filter((a) => a.id && a.discussionUrl);
      return { announcements, selectorMatch };
    }, topicSelectors);
    const announcementsMeta = Array.isArray(announcementsResult)
      ? announcementsResult
      : announcementsResult.announcements;
    if (
      !Array.isArray(announcementsResult) &&
      announcementsResult.selectorMatch
    ) {
      logDomSelectorMatch({
        pageType: 'eclass.announcements',
        groupId: 'eclass.announcements.topic_rows',
        candidateId: announcementsResult.selectorMatch.candidateId,
        selector: announcementsResult.selectorMatch.selector,
        matchCount: announcementsResult.selectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }

    const byDiscussion = new Map<
      string,
      {
        id: string;
        title: string;
        discussionUrl: string;
        date: string;
        author: string;
      }
    >();

    for (const meta of announcementsMeta) {
      const key = meta.discussionUrl || meta.id;
      const prev = byDiscussion.get(key);
      if (!prev) {
        byDiscussion.set(key, meta);
        continue;
      }

      const prevScore = (prev.date ? 1 : 0) + (prev.author ? 1 : 0);
      const nextScore = (meta.date ? 1 : 0) + (meta.author ? 1 : 0);
      if (nextScore > prevScore) {
        byDiscussion.set(key, meta);
      }
    }

    const uniqueMeta = Array.from(byDiscussion.values());
    const topDiscussions = uniqueMeta.slice(0, limit);
    const results: Announcement[] = [];

    for (const meta of topDiscussions) {
      let content = '';
      let rawLinks: Array<{ name: string; url: string }> = [];
      try {
        await page.goto(meta.discussionUrl, GOTO_OPTS);
        const extracted = await page.evaluate(() => {
          const post = document.querySelector('.forumpost, article.forum-post');
          if (!post) {
            return {
              content: '',
              links: [] as Array<{ name: string; url: string }>,
            };
          }

          const body = post.querySelector(
            '.post-content-container, .posting'
          ) as HTMLElement;
          const text = (body?.textContent || body?.innerText || '')
            .replace(/\n\s*\n/g, '\n')
            .trim();

          const links = Array.from(body?.querySelectorAll('a[href]') || []).map(
            (link) => ({
              name: (link.textContent || '').trim(),
              url: (link as HTMLAnchorElement).href || '',
            })
          );

          return { content: text, links };
        });

        content = extracted.content;
        rawLinks = extracted.links;
      } catch {
        // ignore page navigation errors for a single post
      }

      results.push({
        id: meta.id,
        title: meta.title,
        content: content || 'Could not fetch content.',
        date: meta.date,
        author: meta.author,
        discussionUrl: meta.discussionUrl,
        links: extractExternalAnnouncementLinks(rawLinks, meta.discussionUrl),
      });
    }

    return results;
  } finally {
    await page.close();
    await context.close();
  }
}
