import { scraper, SessionExpiredError, Assignment } from '../scraper/eclass.js';
import { cache, TTL } from '../cache/store.js';

export async function getUpcomingDeadlines(daysAhead: number = 14, courseId?: string) {
  try {
    const cacheKey = `deadlines_${courseId || 'all'}`;
    let deadlines = cache.get<Assignment[]>(cacheKey);

    if (!deadlines) {
      deadlines = await scraper.getDeadlines(courseId);
      cache.set(cacheKey, deadlines, TTL.DEADLINES);
    }

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + daysAhead);

    const filtered = deadlines.filter(a => {
      const dueDate = new Date(a.dueDate);
      return dueDate >= now && dueDate <= futureDate;
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify(filtered) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
