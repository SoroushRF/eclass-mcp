import type { Announcement } from '../scraper/eclass';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { runEclassToolBoundary, sessionExpiredResponse } from './tool-boundary';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

export async function getAnnouncements(
  courseId?: string,
  limit: number = 10,
  deps: ToolDependencies = createDefaultToolDependencies()
) {
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

    const announcements = await deps.eclassScraper.getAnnouncements(
      courseId,
      limit
    );
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

  return runEclassToolBoundary({
    toolName: 'get_announcements',
    run,
    onSessionExpired: {
      retry: run,
      fallback: (error) =>
        sessionExpiredResponse(
          'get_announcements',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}
