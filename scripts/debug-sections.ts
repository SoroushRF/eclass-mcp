import { scraper } from '../src/scraper/eclass';

async function investigateSections() {
  console.log('🧪 Investigating Course Formats...');
  try {
    const courses = await scraper.getCourses();
    console.log(`Found ${courses.length} courses.`);

    // @ts-ignore
    const context = await (scraper as any).getAuthenticatedContext();
    
    for (const c of courses) {
      const page = await context.newPage();
      console.log(`\nChecking: ${c.name} (ID: ${c.id})`);
      await page.goto(c.url, { waitUntil: 'load' });
      
      const stats = await page.evaluate(() => {
        const sections = document.querySelectorAll('.section, .course-section, li.section');
        const internalModules = document.querySelectorAll('.activityinstance a, .activity-item a');
        
        // Sometimes "One section per page" courses have links directly to &section=X
        const sectionLinks = Array.from(document.querySelectorAll('a[href*="&section="]') as NodeListOf<HTMLAnchorElement>).map(a => a.href);

        return {
          sectionCount: sections.length,
          moduleCount: internalModules.length,
          sectionLinks: Array.from(new Set(sectionLinks))
        };
      });

      console.log(`  - Standard Sections Found: ${stats.sectionCount}`);
      console.log(`  - Direct Activity Modules Found: ${stats.moduleCount}`);
      console.log(`  - Links to "section=X" paths: ${stats.sectionLinks.length}`);
      
      if (stats.moduleCount === 0 && stats.sectionLinks.length > 0) {
        console.log('  ⚠️ WARNING! This course is using "One section per page"! Main page has no modules, only section links.');
        // Debug first link
        console.log(`  -> First section link: ${stats.sectionLinks[0]}`);
      } else if (stats.moduleCount === 0) {
        console.log('  ⚠️ WARNING! Could not find any standard modules here. It might be empty, or using a totally different template grid.');
      } else {
        console.log('  ✅ Looks like a normal "All sections on one page" format.');
      }
      
      await page.close();
    }
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await scraper.close();
  }
}

investigateSections();
