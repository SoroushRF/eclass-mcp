import { scraper } from '../src/scraper/eclass';
import fs from 'fs';
import path from 'path';

async function checkCourseId() {
  const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=4084996';
  try {
    const context = await (scraper as any).getAuthenticatedContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    const courseId = await page.evaluate(() => {
        // Option 1: M.cfg
        if ((window as any).M?.cfg?.courseId) return (window as any).M.cfg.courseId;
        
        // Option 2: Breadcrumbs
        const breadcrumbLinks = Array.from(document.querySelectorAll('.breadcrumb-item a, .breadcrumb a'));
        for (const a of breadcrumbLinks) {
            const href = (a as HTMLAnchorElement).href;
            const match = href.match(/id=(\d+)/);
            if (href.includes('course/view.php') && match) return match[1];
        }

        // Option 3: Body class
        const bodyClass = document.body.className;
        const bodyMatch = bodyClass.match(/course-(\d+)/);
        if (bodyMatch) return bodyMatch[1];

        return null;
    });

    console.log(`Course ID found: ${courseId}`);
    await page.close();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await scraper.close();
  }
}

checkCourseId();
