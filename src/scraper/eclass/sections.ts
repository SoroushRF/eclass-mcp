import type { EClassBrowserSession } from './browser-session';
import { sanitizeHttpUrlQueryParams, checkSession } from './helpers';
import type { SectionTextData } from './types';
import {
  classifyExternalPlatformCandidate,
  type ExternalPlatformMatch,
} from './external-platforms';
import { getSelectorGroup, logDomSelectorMatch } from '../selectors';
import {
  validateFinalUrlForPolicy,
  validateUrlForPolicy,
} from '../../security/url-policy';

function getPageUrl(page: { url?: () => string }): string | undefined {
  if (typeof page.url !== 'function') return undefined;
  try {
    return page.url();
  } catch {
    return undefined;
  }
}

export async function getSectionText(
  session: EClassBrowserSession,
  url: string
): Promise<SectionTextData> {
  const targetUrl = validateUrlForPolicy(
    sanitizeHttpUrlQueryParams(url),
    'eclass_section'
  );
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    // `networkidle` never settles on Moodle; `load` waits for all subresources and can hit
    // 30s if a tracker/image hangs. `domcontentloaded` + main-region wait tracks real readiness.
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const currentPageUrl = getPageUrl(page);
    if (currentPageUrl) {
      validateFinalUrlForPolicy(currentPageUrl, 'eclass_section');
    }
    await checkSession(page);
    await page
      .waitForSelector('#region-main, [role="main"]', { timeout: 15000 })
      .catch(() => {});

    const selectorGroups = {
      summary: [
        ...getSelectorGroup('eclass.course.section_summary').candidates,
      ],
      tabs: [...getSelectorGroup('eclass.course.section_tabs').candidates],
    };
    const evaluated = await page.evaluate(
      ({ sectionUrl, selectors }) => {
        const root =
          document.querySelector('#region-main') ||
          document.querySelector('[role="main"]') ||
          document.body;

        const title =
          root.querySelector('.sectionname, h2, h3')?.textContent?.trim() ||
          'Section Details';

        const extractLinks = (element: Element) => {
          return Array.from(element.querySelectorAll('a[href]'))
            .map((a) => ({
              name: a.textContent?.trim() || a.getAttribute('href') || 'Link',
              url: (a as HTMLAnchorElement).href,
            }))
            .filter(
              (l) =>
                l.name.length > 0 && l.url && !l.url.startsWith('javascript:')
            );
        };

        let summaryBox: Element | null = null;
        let summarySelectorMatch:
          | {
              candidateId: string;
              selector: string;
              count: number;
            }
          | undefined;
        for (const candidate of selectors.summary) {
          const found = Array.from(root.querySelectorAll(candidate.selector));
          if (found.length > 0) {
            summaryBox = found[0];
            summarySelectorMatch = {
              candidateId: candidate.id,
              selector: candidate.selector,
              count: found.length,
            };
            break;
          }
        }
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

        let navLinks: Element[] = [];
        let tabSelectorMatch:
          | {
              candidateId: string;
              selector: string;
              count: number;
            }
          | undefined;
        for (const candidate of selectors.tabs) {
          const found = Array.from(root.querySelectorAll(candidate.selector));
          if (found.length > 0) {
            navLinks = found;
            tabSelectorMatch = {
              candidateId: candidate.id,
              selector: candidate.selector,
              count: found.length,
            };
            break;
          }
        }
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

        return { result, summarySelectorMatch, tabSelectorMatch };
      },
      { sectionUrl: targetUrl, selectors: selectorGroups }
    );

    if (evaluated.summarySelectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.course',
        groupId: 'eclass.course.section_summary',
        candidateId: evaluated.summarySelectorMatch.candidateId,
        selector: evaluated.summarySelectorMatch.selector,
        matchCount: evaluated.summarySelectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }
    if (evaluated.tabSelectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.course',
        groupId: 'eclass.course.section_tabs',
        candidateId: evaluated.tabSelectorMatch.candidateId,
        selector: evaluated.tabSelectorMatch.selector,
        matchCount: evaluated.tabSelectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }

    const result = 'result' in evaluated ? evaluated.result : evaluated;

    const platforms: ExternalPlatformMatch[] = [];
    const seenPlatforms = new Set<string>();

    const checkLink = (link: { name: string; url: string }) => {
      const match = classifyExternalPlatformCandidate({
        name: link.name,
        url: link.url,
      });
      if (!match) return;

      const identity = `${match.name}|${match.url}`;
      if (!seenPlatforms.has(identity)) {
        seenPlatforms.add(identity);
        platforms.push(match);
      }
    };

    result.mainLinks.forEach(checkLink);
    result.tabs.forEach((tab) => tab.links.forEach(checkLink));

    if (platforms.length > 0) {
      result.external_platforms = platforms;
    }

    return result;
  } finally {
    await page.close();
    await context.close();
  }
}
