import { getAnnouncements } from '../src/tools/announcements';
import { scraper } from '../src/scraper/eclass';

async function testAnnouncements() {
  console.log('🧪 Testing Announcements Tool...');
  try {
    const courses = await scraper.getCourses();
    if (courses.length > 0) {
       console.log(`Using course: ${courses[0].name} - ${courses[0].id}`);
       const result = await getAnnouncements(courses[0].id, 3);
       console.log('\n--- TOOL OUTPUT ---');
       console.log(result.content[0].text);
    } else {
       console.log('No courses found.');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await scraper.close();
  }
}

testAnnouncements();
