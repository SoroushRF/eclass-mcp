import { scraper } from '../src/scraper/eclass';

async function debugClubs101() {
  console.log('🧪 Investigating Clubs 101 format...');
  try {
    const courses = await scraper.getCourses();
    // find a course with "club" in the name
    const course = courses.find(c => c.name.toLowerCase().includes('club'));
    if (!course) {
      console.log('Could not find Clubs course.');
      return;
    }
    console.log(`Found: ${course.name} (ID: ${course.id})`);

    const context = await scraper['getAuthenticatedContext']();
    const page = await context.newPage();
    await page.goto(course.url, { waitUntil: 'load' });
    
    // Dump an overview of the HTML layout so we can see what elements contain links
    const layoutOverview = await page.evaluate(() => {
      const basicLinks = document.querySelectorAll('a[href]').length;
      
      const potentialSections = document.querySelectorAll('.section, .course-section, .tile, .grid_section, .course-content > ul > li');
      const standardModules = document.querySelectorAll('.activityinstance a, .activity-item a');
      const allModules = document.querySelectorAll('a[href*="mod/"]');
      
      // Let's dump the first few links that look like modules just to see their classes
      const topLinks = Array.from(allModules)
         .slice(0, 5)
         .map(a => `<a class="${a.className}" href="${(a as HTMLAnchorElement).href}">${a.textContent?.trim()}</a>`);

      return {
        basicLinks,
        potentialSectionsCount: potentialSections.length,
        standardModulesCount: standardModules.length,
        allModulesCount: allModules.length,
        topLinks
      };
    });

    require('fs').writeFileSync('scripts/clubs-output.json', JSON.stringify(layoutOverview, null, 2));
    console.log('Saved to scripts/clubs-output.json');

    await page.close();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await scraper.close();
  }
}
debugClubs101();
