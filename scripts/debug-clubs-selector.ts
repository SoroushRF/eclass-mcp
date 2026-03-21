import { scraper } from '../src/scraper/eclass';

async function debugClubsSelector() {
  try {
    const courses = await scraper.getCourses();
    const course = courses.find(c => c.name.toLowerCase().includes('club'));
    if (!course) return;

    const context = await scraper['getAuthenticatedContext']();
    const page = await context.newPage();
    await page.goto(course.url, { waitUntil: 'load' });
    
    const layout = await page.evaluate(() => {
      // find all modules
      const a = document.querySelector('.activityinstance a, .activity-item a');
      if (!a) return { error: 'No standard modules found' };

      // Walk up the DOM to find the parent li or section container
      let parent = a.parentElement;
      let hierarchy = [];
      while (parent && parent.tagName !== 'BODY') {
        hierarchy.push({
          tag: parent.tagName,
          className: parent.className,
          id: parent.id
        });
        parent = parent.parentElement;
      }
      return hierarchy;
    });

    require('fs').writeFileSync('scripts/clubs-hierarchy.json', JSON.stringify(layout, null, 2));

    await page.close();
  } catch (err) {
    console.error(err);
  } finally {
    await scraper.close();
  }
}
debugClubsSelector();
