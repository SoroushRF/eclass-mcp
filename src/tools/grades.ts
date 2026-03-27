import { scraper, SessionExpiredError, Grade } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';

export async function getGrades(courseId?: string) {
  try {
    const cacheKey = getCacheKey('grades', courseId || 'all');
    const cached = cache.getWithMeta<Grade[]>(cacheKey);

    if (cached) {
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      });
      return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
    }

    const grades = await scraper.getGrades(courseId);
    cache.set(cacheKey, grades, TTL.GRADES);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.GRADES * 60000);
    const resp = attachCacheMeta(grades, {
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
