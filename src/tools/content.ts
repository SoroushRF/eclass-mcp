import {
  scraper,
  SessionExpiredError,
  CourseContent,
  SectionTextData,
} from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';

export async function getCourseContent(courseId: string) {
  try {
    const cacheKey = getCacheKey('content', courseId);
    const cached = cache.getWithMeta<CourseContent>(cacheKey);

    if (cached) {
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
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
    console.error(`[MCP Server] Claude requested section text for: ${url}`);
    const cacheKey = getCacheKey('sectiontext', url);
    const cached = cache.getWithMeta<SectionTextData>(cacheKey);

    if (cached) {
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
      };
    }

    const content = await scraper.getSectionText(url);
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
