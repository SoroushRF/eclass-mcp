import { scraper, SessionExpiredError, Announcement } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';

export async function getAnnouncements(courseId?: string, limit: number = 10) {
  try {
    const cacheKey = `announcements_${courseId || 'all'}_${limit}`;
    const cached = cache.get<Announcement[]>(cacheKey);
    if (cached) return { content: [{ type: 'text', text: JSON.stringify(cached) }] };
    
    const announcements = await scraper.getAnnouncements(courseId, limit);
    cache.set(cacheKey, announcements, TTL.ANNOUNCEMENTS);
    return { content: [{ type: 'text', text: JSON.stringify(announcements) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text', text: e.message }] };
    }
    throw e;
  }
}
