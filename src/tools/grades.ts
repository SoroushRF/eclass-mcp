import type { Grade } from '../scraper/eclass';
import { cache, TTL, attachCacheMeta } from '../cache/store';
import { tryGetEclassCacheKey } from '../cache/account-scope';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { runEclassToolBoundary, sessionExpiredResponse } from './tool-boundary';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

export async function getGrades(
  courseId?: string,
  deps: ToolDependencies = createDefaultToolDependencies()
) {
  const run = async () => {
    const cacheKey = tryGetEclassCacheKey('grades', courseId || 'all');
    const cached = cacheKey ? cache.getWithMeta<Grade[]>(cacheKey) : null;

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

    const grades = await deps.eclassScraper.getGrades(courseId);
    if (cacheKey) cache.set(cacheKey, grades, TTL.GRADES);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.GRADES * 60000);
    const resp = attachCacheMeta(grades, {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return asValidatedMcpText('get_grades', EclassToolJsonPayloadSchema, resp);
  };

  return runEclassToolBoundary({
    toolName: 'get_grades',
    run,
    onSessionExpired: {
      retry: run,
      fallback: (error) =>
        sessionExpiredResponse(
          'get_grades',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}
