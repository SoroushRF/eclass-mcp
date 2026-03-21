import { scraper, SessionExpiredError, CourseContent, SectionTextData } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';

export async function getCourseContent(courseId: string) {
  try {
    const cacheKey = `content_v3_${courseId}`;
    const cached = cache.get<CourseContent>(cacheKey);
    if (cached) return { content: [{ type: 'text' as const, text: JSON.stringify(cached) }] };
    
    const content = await scraper.getCourseContent(courseId);
    cache.set(cacheKey, content, TTL.CONTENT);
    return { content: [{ type: 'text' as const, text: JSON.stringify(content) }] };
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
    // Generate a safe cache key from the URL stripping special chars
    const cacheKey = `sectiontext_v2_${url.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const cached = cache.get<SectionTextData>(cacheKey);
    if (cached) return { content: [{ type: 'text' as const, text: JSON.stringify(cached) }] };
    
    const content = await scraper.getSectionText(url);
    cache.set(cacheKey, content, TTL.CONTENT); // Re-use content TTL
    return { content: [{ type: 'text' as const, text: JSON.stringify(content) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
