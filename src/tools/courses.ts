import { scraper, SessionExpiredError, Course } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';

export async function listCourses() {
  try {
    const cacheKey = getCacheKey('courses');
    const cached = cache.getWithMeta<Course[]>(cacheKey);

    if (cached) {
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
      };
    }

    const courses = await scraper.getCourses();
    cache.set(cacheKey, courses, TTL.COURSES);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.COURSES * 60000);
    const resp = attachCacheMeta({ courses }, {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
    };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
