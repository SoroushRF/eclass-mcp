import { scraper } from '../src/scraper/eclass';

async function diagnoseTabs() {
  console.log('🧪 Diagnosing Tabs in Clubs 101 Section 4...');
  const url = 'https://eclass.yorku.ca/course/view.php?id=148310&section=4';
  
  try {
    const context = await scraper['getAuthenticatedContext']();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });

    const diagnosis = await page.evaluate(() => {
      // 1. Check Course Index left menu
      const courseIndexItems = Array.from(document.querySelectorAll('.courseindex-item a.courseindex-link'))
        .map(a => a.textContent?.trim() || '')
        .filter(t => t.length > 0);

      // 2. Check for Tabs or collapse headers on the page
      const tabs = Array.from(document.querySelectorAll('.nav-tabs .nav-link, .menutab, button[data-toggle="tab"], .yui3-tab, .tab-pane'))
        .map(el => ({
           tag: el.tagName,
           class: el.className,
           text: el.textContent?.trim()?.substring(0, 30) || 'no-text'
        }));

      // 3. Count standard modules visible right now vs in course index
      const visibleModules = Array.from(document.querySelectorAll('.activityinstance a, .activity-item a'))
        .map(a => a.textContent?.trim() || '');

      // 4. Look for raw links or content inside tab panels
      const rawLinksInTabs = Array.from(document.querySelectorAll('.tab-content a[href], .tab-pane a[href]'))
        .map(a => ({
          text: a.textContent?.trim()?.substring(0, 30),
          href: (a as HTMLAnchorElement).href
        }));

      return {
        courseIndexItemCount: courseIndexItems.length,
        visibleModulesCount: visibleModules.length,
        tabsFound: tabs.length,
        tabsPreview: tabs.slice(0, 10),
        rawLinksInTabsCount: rawLinksInTabs.length,
        courseIndexSample: courseIndexItems.slice(0, 5)
      };
    });

    require('fs').writeFileSync('scripts/tabs-diagnosis.json', JSON.stringify(diagnosis, null, 2));
    console.log('Saved to scripts/tabs-diagnosis.json');

    await page.close();
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await scraper.close();
  }
}
diagnoseTabs();
