import { scraper } from '../src/scraper/eclass';

async function deepDebug() {
  console.log('🧪 Starting Announcements HTML Dump...');
  
  try {
    const context = await scraper['getAuthenticatedContext']();
    const page = await context.newPage();

    // Visit dashboard
    await page.goto(`https://eclass.yorku.ca/my/`, { waitUntil: 'networkidle' });

    console.log('Fetching course list to find a course ID...');
    const courses = await scraper.getCourses();
    if (courses.length === 0) {
      console.log('No courses found.');
      return;
    }

    const testCourseId = courses[0].id;
    console.log(`Using course: ${courses[0].name} (ID: ${testCourseId})`);

    // Go to course to find the forum link
    await page.goto(`https://eclass.yorku.ca/course/view.php?id=${testCourseId}`, { waitUntil: 'networkidle' });

    // Find the Announcements forum URL
    const forumUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="mod/forum/view.php"]')) as HTMLAnchorElement[];
      // Try to find one containing "Announcement" or "News", or just take the first one
      const target = links.find(l => /announcement|news|forum/i.test(l.textContent || '')) || links[0];
      return target?.href;
    });

    if (!forumUrl) {
      console.log('Could not find any forum link on the main course page.');
      // Fallback to checking the dashboard
      return;
    }

    console.log(`\nNavigating to forum list: ${forumUrl}`);
    await page.goto(forumUrl, { waitUntil: 'networkidle' });

    const htmlOutput = [];
    // Dump a row's HTML
    htmlOutput.push('\n--- DUMPING ONE FORUM DISCUSSION ROW (HTML) ---');
    const rowHtml = await page.evaluate(() => {
      const row = document.querySelector('tr.discussion');
      return row ? row.outerHTML : 'No tr.discussion found.';
    });
    htmlOutput.push(rowHtml);

    // Get the first discussion URL
    const discussionUrl = await page.evaluate(() => {
      const firstLink = document.querySelector('tr.discussion a[href*="discuss.php"]') as HTMLAnchorElement;
      return firstLink?.href;
    });

    if (!discussionUrl) {
      htmlOutput.push('\nCould not find a discussion link inside the forum.');
    } else {
      htmlOutput.push(`\nNavigating to discussion: ${discussionUrl}`);
      await page.goto(discussionUrl, { waitUntil: 'networkidle' });
      
      htmlOutput.push('\n--- DUMPING FIRST FORUM POST (HTML) ---');
      const postHtml = await page.evaluate(() => {
        const post = document.querySelector('.forumpost, article.forum-post');
        return post ? post.outerHTML : 'No post found.';
      });
      htmlOutput.push(postHtml);
    }
    
    require('fs').writeFileSync('scripts/announcements_raw.html', htmlOutput.join('\n'));
    console.log('Saved to scripts/announcements_raw.html');

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await scraper.close();
  }
}

deepDebug();
