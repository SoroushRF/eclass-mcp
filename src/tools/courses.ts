import { scraper, SessionExpiredError, Course } from '../scraper/eclass';
import { cache, TTL } from '../cache/store';

export async function listCourses() {
  try {
    const cached = cache.get<Course[]>('courses');
    if (cached) return { content: [{ type: 'text' as const, text: JSON.stringify(cached) }] };
    
    const courses = await scraper.getCourses();
    cache.set('courses', courses, TTL.COURSES);
    return { content: [{ type: 'text' as const, text: JSON.stringify(courses) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
