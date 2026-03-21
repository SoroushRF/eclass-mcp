import { scraper } from '../src/scraper/eclass';

async function testCourseIndex() {
  const context = await scraper['getAuthenticatedContext']();
  const page = await context.newPage();
  
  // Clubs 101 course ID (we don't know the exact ID but wait, let's fetch it)
  const courses = await scraper.getCourses();
  const course = courses.find(c => c.name.toLowerCase().includes('club'));
  if (!course) return;

  await page.goto(course.url, { waitUntil: 'load' });

  const indexData = await page.evaluate(() => {
    // The new Moodle 4 course index sidebar
    const indexBlocks = document.querySelectorAll('.courseindex-section');
    if (indexBlocks.length > 0) {
      return Array.from(indexBlocks).map(sec => {
        const title = sec.querySelector('.courseindex-section-title .courseindex-link')?.textContent?.trim() || 'General';
        const links = Array.from(sec.querySelectorAll('.courseindex-item a.courseindex-link'));
        const items = links.map(a => ({
          name: a.textContent?.trim(),
          url: (a as HTMLAnchorElement).href
        }));
        return { title, items };
      }).filter(s => s.items.length > 0);
    }
    return [];
  });

  console.log('INDEX DATA:');
  console.log(JSON.stringify(indexData, null, 2));

  await scraper.close();
}
testCourseIndex();
