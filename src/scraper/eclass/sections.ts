import type { EClassBrowserSession } from './browser-session';
import type { SectionTextData } from './types';

export async function getSectionText(
  session: EClassBrowserSession,
  url: string
): Promise<SectionTextData> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    return await page.evaluate((sectionUrl) => {
      const title =
        document.querySelector('.sectionname, h2, h3')?.textContent?.trim() ||
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

      const summaryBox = document.querySelector(
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
        document.querySelectorAll('.nav-tabs .nav-link, [role="tablist"] [role="tab"]')
      );
      const tabPanes = Array.from(
        document.querySelectorAll('.tab-content .tab-pane, [role="tabpanel"]')
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

      return {
        url: sectionUrl,
        title,
        mainText,
        mainLinks,
        tabs,
      };
    }, url);
  } finally {
    await page.close();
    await context.close();
  }
}
