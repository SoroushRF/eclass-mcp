import { scraper, SessionExpiredError, Course } from '../scraper/eclass';
import { getAuthUrl, openAuthWindow } from '../auth/server';
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
    if (courses.length > 0) {
      cache.set(cacheKey, courses, TTL.COURSES);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.COURSES * 60000);
    const payload =
      courses.length === 0
        ? {
            courses,
            status: 'no_data',
            message:
              'No eClass courses were detected. If you are enrolled, re-authenticate and retry.',
            retry: {
              afterAuth: true,
              authUrl: getAuthUrl('eclass'),
            },
          }
        : { courses };

    const resp = attachCacheMeta(payload, {
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
      const payload = {
        status: 'auth_required',
        message: e.message,
        retry: {
          afterAuth: true,
          authUrl: getAuthUrl('eclass'),
        },
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      };
    }
    throw e;
  }
}
