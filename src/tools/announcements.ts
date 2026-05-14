import { scraper, SessionExpiredError, Announcement } from '../scraper/eclass';
import { getAuthUrl } from '../auth/server';
import { sessionExpiredPayload } from '../errors/tool-error';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import {
  handleEclassSessionExpired,
  isSessionStorageUnavailable,
  sessionStorageUnavailableResponse,
} from './auth-retry';

export async function getAnnouncements(courseId?: string, limit: number = 10) {
  const run = async () => {
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
  };

  try {
    return await run();
  } catch (e) {
    if (isSessionStorageUnavailable(e)) {
      return sessionStorageUnavailableResponse('get_announcements');
    }
    if (e instanceof SessionExpiredError) {
      return handleEclassSessionExpired(e, run, (error) =>
        asValidatedMcpText(
          'get_announcements',
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
