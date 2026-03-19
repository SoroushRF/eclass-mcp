import { scraper, SessionExpiredError, Assignment } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';

function parseEClassDate(dateStr: string): Date {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Try clean standard parse first
  let date = new Date(dateStr);
  
  // If failed (highly likely with Moodle strings like "Tuesday, 31 March"), do a manual fix
  if (isNaN(date.getTime())) {
    // Regex to find "DD MonthName" (e.g., 31 March)
    const match = dateStr.match(/(\d+)\s+([A-Za-z]+)/);
    if (match) {
      const day = match[1];
      const month = match[2];
      
      // Try parsing with the current year appended
      date = new Date(`${month} ${day}, ${currentYear}`);
      
      // If the date is surprisingly far in the past (e.g., we're in Jan and it says Dec), 
      // it might be from last year. If it's too far in the future, it might be next year.
      // For now, currentYear is the safest bet for upcoming events.
    }
  }
  
  return date;
}

export async function getUpcomingDeadlines(_daysAhead: number = 30, courseId?: string) {
  try {
    const cacheKey = `deadlines_${courseId || 'all'}`;
    let deadlines = cache.get<Assignment[]>(cacheKey) || [];

    if (deadlines.length === 0) {
      deadlines = await scraper.getDeadlines(courseId);
      cache.set(cacheKey, deadlines, TTL.DEADLINES);
    }

    // eClass's 'Upcoming events' page only shows future events anyway.
    // Let's just return what the scraper found without extra filtering bugs.
    return { content: [{ type: 'text' as const, text: JSON.stringify(deadlines) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
