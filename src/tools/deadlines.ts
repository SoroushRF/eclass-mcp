import { scraper, SessionExpiredError, Assignment } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';

export async function getUpcomingDeadlines(daysAhead: number = 14, courseId?: string) {
  try {
    const cacheKey = `deadlines_${courseId || 'all'}`;
    let deadlines = cache.get<Assignment[]>(cacheKey) || [];

    if (deadlines.length === 0) {
      deadlines = await scraper.getDeadlines(courseId);
      cache.set(cacheKey, deadlines, TTL.DEADLINES);
    }

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + (daysAhead || 14));

    const filtered = (deadlines || []).filter(a => {
      const dueDate = new Date(a.dueDate);
      if (isNaN(dueDate.getTime())) return false;
      return dueDate >= now && dueDate <= futureDate;
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify(filtered) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
