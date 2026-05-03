import { scraper, SessionExpiredError, Course } from '../scraper/eclass';
import { getAuthUrl } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { sessionExpiredPayload } from '../errors/tool-error';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { handleEclassSessionExpired } from './auth-retry';

export async function listCourses() {
  const run = async () => {
    const cacheKey = getCacheKey('courses');
    const cached = cache.getWithMeta<Course[]>(cacheKey);

    if (cached) {
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      });
      return asValidatedMcpText(
        'list_courses',
        EclassToolJsonPayloadSchema,
        resp
      );
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

    return asValidatedMcpText(
      'list_courses',
      EclassToolJsonPayloadSchema,
      resp
    );
  };

  try {
    return await run();
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return handleEclassSessionExpired(e, run, (error) =>
        asValidatedMcpText(
          'list_courses',
          EclassToolJsonPayloadSchema,
          sessionExpiredPayload(error.message, {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          })
        )
      );
    }
    throw e;
  }
}
