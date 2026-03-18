import { scraper, SessionExpiredError, Grade } from '../scraper/eclass.js';
import { cache, TTL } from '../cache/store.js';

export async function getGrades(courseId?: string) {
  try {
    const cacheKey = `grades_${courseId || 'all'}`;
    const cached = cache.get<Grade[]>(cacheKey);
    if (cached) return { content: [{ type: 'text', text: JSON.stringify(cached) }] };
    
    const grades = await scraper.getGrades(courseId);
    cache.set(cacheKey, grades, TTL.GRADES);
    return { content: [{ type: 'text', text: JSON.stringify(grades) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return { content: [{ type: 'text', text: e.message }] };
    }
    throw e;
  }
}
