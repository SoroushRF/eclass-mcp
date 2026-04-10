import { scraper, SessionExpiredError, Announcement } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';

export async function getAnnouncements(courseId?: string, limit: number = 10) {
  try {
    const cacheKey = getCacheKey(
      'announcements',
      'v2',
      courseId || 'all',
      limit.toString()
    );
    const cached = cache.getWithMeta<Announcement[]>(cacheKey);

    if (cached) {
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      });
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    }

    const announcements = await scraper.getAnnouncements(courseId, limit);
    cache.set(cacheKey, announcements, TTL.ANNOUNCEMENTS);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.ANNOUNCEMENTS * 60000);
    const resp = attachCacheMeta(announcements, {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text', text: e.message }] };
    }
    throw e;
  }
}
