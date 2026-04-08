import type { EClassBrowserSession } from './browser-session';
import { sanitizeHttpUrlQueryParams, checkSession } from './helpers';
import type { SectionTextData } from './types';
import { EXTERNAL_PLATFORMS } from './external-platforms';

export async function getSectionText(
  session: EClassBrowserSession,
  url: string
): Promise<SectionTextData> {
  const targetUrl = sanitizeHttpUrlQueryParams(url);
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    // `networkidle` never settles on Moodle; `load` waits for all subresources and can hit
    // 30s if a tracker/image hangs. `domcontentloaded` + main-region wait tracks real readiness.
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await checkSession(page);
    await page
      .waitForSelector('#region-main, [role="main"]', { timeout: 15000 })
      .catch(() => {});

    return await page.evaluate((sectionUrl) => {
      const root =
        document.querySelector('#region-main') ||
        document.querySelector('[role="main"]') ||
        document.body;

      const title =
        root
          .querySelector('.sectionname, h2, h3')
          ?.textContent?.trim() ||
        'Section Details';

      const extractLinks = (element: Element) => {
        return Array.from(element.querySelectorAll('a[href]'))
          .map((a) => ({
            name: a.textContent?.trim() || a.getAttribute('href') || 'Link',
            url: (a as HTMLAnchorElement).href,
          }))
          .filter(
            (l) => l.name.length > 0 && l.url && !l.url.startsWith('javascript:')
          );
      };

      const summaryBox = root.querySelector(
        '.summary, .course-description, .section-summary, .description'
      );
      let mainText = '';
      let mainLinks: any[] = [];

      if (summaryBox) {
        const clone = summaryBox.cloneNode(true) as HTMLElement;
        const tabsContainers = clone.querySelectorAll(
          '.nav-tabs, .tab-content, .tab-pane, [role="tablist"], [role="tabpanel"]'
        );
        tabsContainers.forEach((n) => n.remove());
        mainText = clone.textContent?.replace(/\n\s*\n/g, '\n').trim() || '';
        mainLinks = extractLinks(clone);
      }

      const tabs: Array<{
        title: string;
        content: string;
        links: Array<{ name: string; url: string }>;
      }> = [];

      const navLinks = Array.from(
        root.querySelectorAll(
          '.nav-tabs .nav-link, [role="tablist"] [role="tab"]'
        )
      );
      const tabPanes = Array.from(
        root.querySelectorAll('.tab-content .tab-pane, [role="tabpanel"]')
      );

      if (navLinks.length > 0 && navLinks.length === tabPanes.length) {
        for (let i = 0; i < navLinks.length; i++) {
          const tabTitle = navLinks[i].textContent?.trim() || `Tab ${i + 1}`;
          const tabContent =
            tabPanes[i].textContent?.replace(/\n\s*\n/g, '\n').trim() || '';
          const tabLinks = extractLinks(tabPanes[i]);

          if (tabContent || tabLinks.length > 0) {
            tabs.push({
              title: tabTitle,
              content: tabContent,
              links: tabLinks,
            });
          }
        }
      } else if (tabPanes.length > 0) {
        tabPanes.forEach((pane, i) => {
          const tabContent =
            pane.textContent?.replace(/\n\s*\n/g, '\n').trim() || '';
          const tabLinks = extractLinks(pane);
          if (tabContent || tabLinks.length > 0) {
            tabs.push({
              title: `Panel ${i + 1}`,
              content: tabContent,
              links: tabLinks,
            });
          }
        });
      }

      const result: SectionTextData = {
        url: sectionUrl,
        title,
        mainText,
        mainLinks,
        tabs,
      };

      const platforms: { name: string; url: string }[] = [];
      const seenPlatforms = new Set<string>();
      
      const checkLink = (l: {name: string, url: string}) => {
        if(l.url.includes('mod/lti/view.php')) {
          const lowerName = l.name.toLowerCase();
          const lowerUrl = l.url.toLowerCase();
          let platformName = 'unknown_lti';
          if (EXTERNAL_PLATFORMS.KEYWORDS.CENGAGE.some((k: string) => lowerName.includes(k) || lowerUrl.includes(k))) {
             platformName = 'cengage';
          } else if (EXTERNAL_PLATFORMS.KEYWORDS.CROWDMARK.some((k: string) => lowerName.includes(k) || lowerUrl.includes(k))) {
             platformName = 'crowdmark';
          }
          if (!seenPlatforms.has(platformName)) {
            seenPlatforms.add(platformName);
            platforms.push({ name: platformName, url: l.url });
          }
        }
      };
      
      result.mainLinks.forEach(checkLink);
      result.tabs.forEach(t => t.links.forEach(checkLink));
      
      if (platforms.length > 0) result.external_platforms = platforms;
      
      return result;
    }, targetUrl);
  } finally {
    await page.close();
    await context.close();
  }
}
