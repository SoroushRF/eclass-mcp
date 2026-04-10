import {
  scraper,
  SessionExpiredError,
  CourseContent,
  SectionTextData,
} from '../scraper/eclass';
import { sanitizeHttpUrlQueryParams } from '../scraper/eclass/helpers';
import { openAuthWindow } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';

export async function getCourseContent(courseId: string) {
  try {
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
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
      };
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

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
    };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}

export async function getSectionText(url: string) {
  try {
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
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
      };
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

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
    };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
