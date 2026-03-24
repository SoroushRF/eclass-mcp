import type { EClassBrowserSession } from './browser-session';
import { ECLASS_URL } from './browser-session';
import type { Announcement } from './types';

export async function getAnnouncements(
  session: EClassBrowserSession,
  courseId?: string,
  limit: number = 10
): Promise<Announcement[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    let forumUrl = '';

    if (courseId) {
      await page.goto(`${ECLASS_URL}/mod/forum/index.php?id=${courseId}`, {
        waitUntil: 'networkidle',
      });

      forumUrl = await page.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll('.generaltable a[href*="mod/forum/view.php"]')
        ) as HTMLAnchorElement[];
        const target =
          links.find((l) => /announcement|news|forum/i.test(l.textContent || '')) ||
          links[0];
        return target ? target.href : '';
      });

      if (!forumUrl) {
        forumUrl = `${ECLASS_URL}/course/view.php?id=${courseId}`;
      }
    } else {
      forumUrl = `${ECLASS_URL}/my/`;
    }

    await page.goto(forumUrl, { waitUntil: 'networkidle' });

    if (forumUrl.includes('course/view')) {
      const foundLink = await page.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll('a[href*="mod/forum/view.php"]')
        ) as HTMLAnchorElement[];
        const target =
          links.find((l) => /announcement|news|forum/i.test(l.textContent || '')) ||
          links[0];
        return target?.href || '';
      });
      if (foundLink) {
        await page.goto(foundLink, { waitUntil: 'networkidle' });
      } else {
        return [];
      }
    }

    const announcementsMeta = await page.evaluate(() => {
      const topics = Array.from(document.querySelectorAll('.topic, .discussion'));
      return topics
        .map((row) => {
          const titleLink = row.querySelector(
            '.subject a, .topic-name a, th.topic a'
          ) as HTMLAnchorElement;

          let authorText = row.querySelector('.author')?.textContent?.trim() || '';
          if (!authorText) {
            const authorDiv = row.querySelectorAll('.author-info .text-truncate');
            if (authorDiv.length > 0)
              authorText = authorDiv[0].textContent?.trim() || '';
          }

          let dateText =
            row.querySelector('.lastpost date, .modified')?.textContent?.trim() ||
            '';
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
    });

    const topDiscussions = announcementsMeta.slice(0, limit);
    const results: Announcement[] = [];

    for (const meta of topDiscussions) {
      let content = '';
      try {
        await page.goto(meta.discussionUrl, { waitUntil: 'networkidle' });
        content = await page.evaluate(() => {
          const post = document.querySelector('.forumpost, article.forum-post');
          if (!post) return '';
          const body = post.querySelector(
            '.post-content-container, .posting'
          ) as HTMLElement;
          const text = body?.textContent || body?.innerText || '';
          return text.replace(/\n\s*\n/g, '\n').trim();
        });
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
      });
    }

    return results;
  } finally {
    await page.close();
    await context.close();
  }
}
