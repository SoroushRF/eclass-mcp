import {
  scraper,
  SessionExpiredError,
  CourseContent,
  SectionTextData,
} from '../scraper/eclass';
import { getAuthUrl } from '../auth/server';
import { sessionExpiredPayload, toErrorPayload } from '../errors/tool-error';
import { ValidationError } from '../errors/validation-error';
import {
  EclassToolErrorResponseSchema,
  EclassToolJsonPayloadSchema,
} from './eclass-contracts';
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
import { redactUrlForLog, validateUrlForPolicy } from '../security/url-policy';

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
    if (e instanceof ValidationError) {
      return asValidatedMcpText(
        'get_section_text',
        EclassToolErrorResponseSchema,
        toErrorPayload('VALIDATION_FAILED', e.message, {
          ...(e.details ? { details: e.details } : {}),
        })
      );
    }
    throw e;
  }
}
