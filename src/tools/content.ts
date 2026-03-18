import { scraper, SessionExpiredError, CourseContent } from '../scraper/eclass';
import { cache, TTL } from '../cache/store';

export async function getCourseContent(courseId: string) {
  try {
    const cacheKey = `content_${courseId}`;
    const cached = cache.get<CourseContent>(cacheKey);
    if (cached) return { content: [{ type: 'text' as const, text: JSON.stringify(cached) }] };
    
    const content = await scraper.getCourseContent(courseId);
    cache.set(cacheKey, content, TTL.CONTENT);
    return { content: [{ type: 'text' as const, text: JSON.stringify(content) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
