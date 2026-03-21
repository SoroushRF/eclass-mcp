import { scraper } from '../src/scraper/eclass';

async function testSectionAll() {
  const context = await scraper['getAuthenticatedContext']();
  const page = await context.newPage();
  const courseId = '149363'; // LE/ENG 1102 M, N, O, P
  
  // Test 1: Just the ID
  await page.goto(`https://eclass.yorku.ca/course/view.php?id=${courseId}`, { waitUntil: 'load' });
  let countNormal = await page.evaluate(() => document.querySelectorAll('.activityinstance a, .activity-item a').length);
  
  // Test 2: &section=all
  await page.goto(`https://eclass.yorku.ca/course/view.php?id=${courseId}&section=all`, { waitUntil: 'load' });
  let countAll = await page.evaluate(() => document.querySelectorAll('.activityinstance a, .activity-item a').length);
  
  if (countAll > countNormal) {
    console.log(`SUCCESS! &section=all worked. Normal: ${countNormal}, All: ${countAll}`);
  } else {
    console.log(`FAILED! &section=all did not expand everything. Normal: ${countNormal}, All: ${countAll}`);
    
    // We must manually scrape each section page.
    // Fetch all section links on the main page.
  }
  await scraper.close();
}
testSectionAll();
