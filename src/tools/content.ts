import {
  scraper,
  SessionExpiredError,
  CourseContent,
  SectionTextData,
} from '../scraper/eclass';
import { sanitizeHttpUrlQueryParams } from '../scraper/eclass/helpers';
import { getAuthUrl } from '../auth/server';
import { sessionExpiredPayload } from '../errors/tool-error';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import {
  handleEclassSessionExpired,
  isSessionStorageUnavailable,
  sessionStorageUnavailableResponse,
} from './auth-retry';
import {
  isScrapeLayoutChanged,
  scrapeLayoutChangedResponse,
} from './scrape-layout-response';

export async function getCourseContent(courseId: string) {
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

    const content = await scraper.getCourseContent(courseId);
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

  try {
    return await run();
  } catch (e) {
    if (isSessionStorageUnavailable(e)) {
      return sessionStorageUnavailableResponse('get_course_content');
    }
    if (isScrapeLayoutChanged(e)) {
      return scrapeLayoutChangedResponse('get_course_content', e);
    }
    if (e instanceof SessionExpiredError) {
      return handleEclassSessionExpired(e, run, (error) =>
        asValidatedMcpText(
          'get_course_content',
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

export async function getSectionText(url: string) {
  const run = async () => {
    const targetUrl = sanitizeHttpUrlQueryParams(url);
    console.error(
      `[MCP Server] Claude requested section text for: ${targetUrl}`
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

    const content = await scraper.getSectionText(targetUrl);
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

  try {
    return await run();
  } catch (e) {
    if (isSessionStorageUnavailable(e)) {
      return sessionStorageUnavailableResponse('get_section_text');
    }
    if (isScrapeLayoutChanged(e)) {
      return scrapeLayoutChangedResponse('get_section_text', e);
    }
    if (e instanceof SessionExpiredError) {
      return handleEclassSessionExpired(e, run, (error) =>
        asValidatedMcpText(
          'get_section_text',
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
