import type { CourseContent, SectionTextData } from '../scraper/eclass';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { runEclassToolBoundary, sessionExpiredResponse } from './tool-boundary';
import { redactUrlForLog, validateUrlForPolicy } from '../security/url-policy';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

export async function getCourseContent(
  courseId: string,
  deps: ToolDependencies = createDefaultToolDependencies()
) {
  const run = async () => {
    const cacheKey = getCacheKey('content', courseId);
    const cached = cache.getWithMeta<CourseContent>(cacheKey);

    if (cached) {
      const stale = 'stale' in cached && cached.stale === true;
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
        ...(stale ? { stale: true } : {}),
      });
      return asValidatedMcpText(
        'get_course_content',
        EclassToolJsonPayloadSchema,
        resp
      );
    }

    const content = await deps.eclassScraper.getCourseContent(courseId);
    cache.set(cacheKey, content, TTL.CONTENT);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.CONTENT * 60000);
    const resp = attachCacheMeta(content, {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return asValidatedMcpText(
      'get_course_content',
      EclassToolJsonPayloadSchema,
      resp
    );
  };

  return runEclassToolBoundary({
    toolName: 'get_course_content',
    run,
    onSessionExpired: {
      retry: run,
      fallback: (error) =>
        sessionExpiredResponse(
          'get_course_content',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}

export async function getSectionText(
  url: string,
  deps: ToolDependencies = createDefaultToolDependencies()
) {
  const run = async () => {
    const targetUrl = validateUrlForPolicy(url, 'eclass_section');
    console.error(
      `[MCP Server] Claude requested section text for: ${redactUrlForLog(targetUrl)}`
    );
    const cacheKey = getCacheKey('sectiontext', targetUrl);
    const cached = cache.getWithMeta<SectionTextData>(cacheKey);

    if (cached) {
      const stale = 'stale' in cached && cached.stale === true;
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
        ...(stale ? { stale: true } : {}),
      });
      return asValidatedMcpText(
        'get_section_text',
        EclassToolJsonPayloadSchema,
        resp
      );
    }

    const content = await deps.eclassScraper.getSectionText(targetUrl);
    cache.set(cacheKey, content, TTL.CONTENT); // Re-use content TTL

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.CONTENT * 60000);
    const resp = attachCacheMeta(content, {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return asValidatedMcpText(
      'get_section_text',
      EclassToolJsonPayloadSchema,
      resp
    );
  };

  return runEclassToolBoundary({
    toolName: 'get_section_text',
    run,
    onSessionExpired: {
      retry: run,
      fallback: (error) =>
        sessionExpiredResponse(
          'get_section_text',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}
