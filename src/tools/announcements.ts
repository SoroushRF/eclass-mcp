import { scraper, SessionExpiredError, Announcement } from '../scraper/eclass';
import { getAuthUrl, openAuthWindow } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';

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
      return asValidatedMcpText(
        'get_announcements',
        EclassToolJsonPayloadSchema,
        resp
      );
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

    return asValidatedMcpText(
      'get_announcements',
      EclassToolJsonPayloadSchema,
      resp
    );
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return asValidatedMcpText(
        'get_announcements',
        EclassToolJsonPayloadSchema,
        {
          status: 'auth_required' as const,
          message: e.message,
          retry: { afterAuth: true, authUrl: getAuthUrl('eclass') },
        }
      );
    }
    throw e;
  }
}
