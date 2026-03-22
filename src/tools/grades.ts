import { scraper, SessionExpiredError, Grade } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';

export async function getGrades(courseId?: string) {
  try {
    const cacheKey = `grades_v2_${courseId || 'all'}`;
    const cached = cache.get<Grade[]>(cacheKey);
    if (cached)
      return { content: [{ type: 'text', text: JSON.stringify(cached) }] };

    const grades = await scraper.getGrades(courseId);
    cache.set(cacheKey, grades, TTL.GRADES);
    return { content: [{ type: 'text', text: JSON.stringify(grades) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text', text: e.message }] };
    }
    throw e;
  }
}
