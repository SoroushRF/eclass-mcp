import { scraper } from '../src/scraper/eclass';

async function testSectionLogic() {
  const context = await scraper['getAuthenticatedContext']();
  const page = await context.newPage();
  const courseId = '149363'; // LE/ENG 1102 M, N, O, P
  
  await page.goto(`https://eclass.yorku.ca/course/view.php?id=${courseId}`, { waitUntil: 'networkidle' });

  // Check if we need to paginate through sections
  const sectionLinks = await page.evaluate(() => {
    // only grab links that actually have "section=" and don't just point to hashes
    const links = Array.from(document.querySelectorAll('a[href*="course/view.php?id="][href*="&section="]')) as HTMLAnchorElement[];
    return Array.from(new Set(links.map(a => a.href)));
  });

  const modulesFound = await page.evaluate(() => document.querySelectorAll('.activityinstance a, .activity-item a').length);

  console.log(`Initial page: ${modulesFound} modules found. Section links found: ${sectionLinks.length}`);

  let sections = [];

  if (modulesFound === 0 && sectionLinks.length > 0) {
    console.log('Iterating through sections because "One section per page" format detected...');
    for (const link of sectionLinks) {
       await page.goto(link, { waitUntil: 'load' }); // load is usually fast enough
       const sectionData = await page.evaluate(() => {
          // A single section view typically has the main section block
          const title = document.querySelector('h2, .sectionname, h3')?.textContent?.trim() || 'Custom Section';
          const moduleLinkEls = Array.from(document.querySelectorAll('.activityinstance a, .activity-item a'));
          
          const items = moduleLinkEls.map(a => {
            const href = (a as HTMLAnchorElement).href;
            let type: 'resource' | 'assign' | 'announcement' | 'other' = 'other';
            if (href.includes('resource')) type = 'resource';
            else if (href.includes('assign')) type = 'assign';
            else if (href.includes('forum')) type = 'announcement';

            return {
              type,
              name: a.querySelector('.instancename, .activityname')?.textContent?.trim() || a.textContent?.trim() || 'Item',
              url: href
            };
          }).filter(i => i.url);
          return { title, items };
       });

       if (sectionData.items.length > 0) {
         sections.push(sectionData);
       }
    }
  } else {
     // Normal evaluation
     sections = await page.evaluate(() => {
        const sectionEls = Array.from(document.querySelectorAll('.section, .course-section'));
        
        return sectionEls.map(s => {
          const title = s.querySelector('.sectionname, h3')?.textContent?.trim() || 'General';
          const moduleLinkEls = Array.from(s.querySelectorAll('.activityinstance a, .activity-item a'));
          
          const items = moduleLinkEls.map(a => {
            const href = (a as HTMLAnchorElement).href;
            let type: 'resource' | 'assign' | 'announcement' | 'other' = 'other';
            if (href.includes('resource')) type = 'resource';
            else if (href.includes('assign')) type = 'assign';
            else if (href.includes('forum')) type = 'announcement';

            return {
              type,
              name: a.querySelector('.instancename, .activityname')?.textContent?.trim() || a.textContent?.trim() || 'Item',
              url: href
            };
          }).filter(i => i.url);

          return { title, items };
        }).filter(s => s.items.length > 0);
      });
  }

  console.log(`Total sections collected: ${sections.length}`);
  if (sections.length > 0) {
    console.log(`Sample first section: ${sections[0].title} with ${sections[0].items.length} items.`);
    if (sections[0].items.length > 0) {
       console.log(`  - ${sections[0].items[0].url}`);
    }
  }

  await scraper.close();
}
testSectionLogic();
