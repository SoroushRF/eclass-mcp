import { scraper, SessionExpiredError, Grade } from '../scraper/eclass';
import { getAuthUrl, openAuthWindow } from '../auth/server';
import { sessionExpiredPayload } from '../errors/tool-error';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';

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
      return asValidatedMcpText(
        'get_grades',
        EclassToolJsonPayloadSchema,
        resp
      );
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

    return asValidatedMcpText('get_grades', EclassToolJsonPayloadSchema, resp);
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return asValidatedMcpText(
        'get_grades',
        EclassToolJsonPayloadSchema,
        sessionExpiredPayload(e.message, {
          afterAuth: true,
          authUrl: getAuthUrl('eclass'),
        })
      );
    }
    throw e;
  }
}
