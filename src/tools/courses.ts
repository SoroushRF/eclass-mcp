import { scraper, SessionExpiredError, Course } from '../scraper/eclass.js';
import { cache, TTL } from '../cache/store.js';

export async function listCourses() {
  try {
    const cached = cache.get<Course[]>('courses');
    if (cached) return { content: [{ type: 'text', text: JSON.stringify(cached) }] };
    
    const courses = await scraper.getCourses();
    cache.set('courses', courses, TTL.COURSES);
    return { content: [{ type: 'text', text: JSON.stringify(courses) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return { content: [{ type: 'text', text: e.message }] };
    }
    throw e;
  }
}
