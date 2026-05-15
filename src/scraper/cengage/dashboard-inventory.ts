import type { Page } from 'playwright';
import {
  extractDashboardCourses,
  extractDashboardCoursesFromCardCandidates,
  type CengageDashboardCardCandidate,
  type CengageDashboardCourse,
} from '../cengage-courses';
import { getSelectorGroup, logDomSelectorMatch } from '../selectors';

export async function extractDashboardCourseInventory(
  page: Page
): Promise<CengageDashboardCourse[]> {
  const selectorGroups = {
    cards: [...getSelectorGroup('cengage.dashboard.course_cards').candidates],
    launch: [...getSelectorGroup('cengage.dashboard.launch_links').candidates],
  };
  const cardResult = await page.evaluate((selectors) => {
    const normalizeText = (value: string | null | undefined): string =>
      (value || '').replace(/\s+/g, ' ').trim();

    const fallbackLaunchPattern =
      /webassign|owlv?2?|cengagenow|coursekey|mindtap|ilrn|nglms|dashboard\/course|\/course\//i;

    const cards: HTMLElement[] = [];
    let cardSelectorMatch:
      | { candidateId: string; selector: string; count: number }
      | undefined;
    for (const candidate of selectors.cards) {
      const found = Array.from(
        document.querySelectorAll<HTMLElement>(candidate.selector)
      );
      if (found.length > 0 && !cardSelectorMatch) {
        cardSelectorMatch = {
          candidateId: candidate.id,
          selector: candidate.selector,
          count: found.length,
        };
      }
      cards.push(...found);
    }

    const seen = new Set<HTMLElement>();
    const uniqueCards = cards.filter((card) => {
      if (seen.has(card)) {
        return false;
      }

      seen.add(card);
      return true;
    });

    const results: CengageDashboardCardCandidate[] = [];
    let launchSelectorMatch:
      | { candidateId: string; selector: string; count: number }
      | undefined;

    for (const card of uniqueCards) {
      let launchAnchor: HTMLAnchorElement | null = null;

      for (const candidate of selectors.launch) {
        const found = Array.from(
          card.querySelectorAll<HTMLAnchorElement>(candidate.selector)
        );
        const matched = found[0];
        if (matched) {
          launchAnchor = matched;
          if (!launchSelectorMatch) {
            launchSelectorMatch = {
              candidateId: candidate.id,
              selector: candidate.selector,
              count: found.length,
            };
          }
          break;
        }
      }

      if (!launchAnchor) {
        launchAnchor =
          Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
            (anchor) => {
              const href = anchor.getAttribute('href') || anchor.href || '';
              const text = normalizeText(anchor.textContent);
              const title = normalizeText(anchor.getAttribute('title'));
              const ariaLabel = normalizeText(
                anchor.getAttribute('aria-label')
              );
              const haystack = `${href} ${text} ${title} ${ariaLabel}`;
              return fallbackLaunchPattern.test(haystack);
            }
          ) || null;
      }

      if (!launchAnchor) {
        continue;
      }

      const launchHref =
        launchAnchor.getAttribute('href') || launchAnchor.href || '';
      if (!normalizeText(launchHref)) {
        continue;
      }

      const titleElement = card.querySelector<HTMLElement>(
        '[data-testid="home-page-title"], [data-testid*="home-page-title"], [data-test="home-page-title"], [data-test*="home-page-title"], .home-page-title, [class*="home-page-title"], h2, h3, [role="heading"]'
      );

      results.push({
        cardId:
          normalizeText(card.id) ||
          normalizeText(card.getAttribute('data-test')),
        cardTitle:
          normalizeText(titleElement?.textContent) ||
          normalizeText(card.getAttribute('data-course-title')),
        launchHref,
        launchText: normalizeText(launchAnchor.textContent),
        launchTitleAttr: normalizeText(launchAnchor.getAttribute('title')),
        launchAriaLabel: normalizeText(launchAnchor.getAttribute('aria-label')),
        dataCourseId:
          normalizeText(
            launchAnchor.getAttribute('data-course-id') ||
              launchAnchor.getAttribute('data-courseid')
          ) ||
          normalizeText(card.getAttribute('data-course-id')) ||
          normalizeText(card.getAttribute('data-courseid')),
        dataCourseKey:
          normalizeText(
            launchAnchor.getAttribute('data-course-key') ||
              launchAnchor.getAttribute('data-coursekey')
          ) ||
          normalizeText(card.getAttribute('data-course-key')) ||
          normalizeText(card.getAttribute('data-coursekey')),
      });
    }

    return { cardCandidates: results, cardSelectorMatch, launchSelectorMatch };
  }, selectorGroups);
  const cardCandidates: CengageDashboardCardCandidate[] =
    cardResult.cardCandidates;
  if (cardResult.cardSelectorMatch) {
    logDomSelectorMatch({
      pageType: 'cengage.dashboard',
      groupId: 'cengage.dashboard.course_cards',
      candidateId: cardResult.cardSelectorMatch.candidateId,
      selector: cardResult.cardSelectorMatch.selector,
      matchCount: cardResult.cardSelectorMatch.count,
      url: typeof page.url === 'function' ? page.url() : undefined,
    });
  }
  if (cardResult.launchSelectorMatch) {
    logDomSelectorMatch({
      pageType: 'cengage.dashboard',
      groupId: 'cengage.dashboard.launch_links',
      candidateId: cardResult.launchSelectorMatch.candidateId,
      selector: cardResult.launchSelectorMatch.selector,
      matchCount: cardResult.launchSelectorMatch.count,
      url: typeof page.url === 'function' ? page.url() : undefined,
    });
  }

  const pageUrl = typeof page.url === 'function' ? page.url() : '';
  const cardCourses = extractDashboardCoursesFromCardCandidates(
    cardCandidates,
    pageUrl
  );
  if (cardCourses.length > 0) {
    return cardCourses;
  }

  const candidates = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href]')
    ).map((anchor) => {
      const href = anchor.getAttribute('href') || anchor.href || '';
      const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();

      return {
        href,
        text,
        titleAttr: (anchor.getAttribute('title') || '').trim(),
        ariaLabel: (anchor.getAttribute('aria-label') || '').trim(),
        dataCourseId: (
          anchor.getAttribute('data-course-id') ||
          anchor.getAttribute('data-courseid') ||
          ''
        ).trim(),
        dataCourseKey: (
          anchor.getAttribute('data-course-key') ||
          anchor.getAttribute('data-coursekey') ||
          ''
        ).trim(),
      };
    });
  });

  return extractDashboardCourses(candidates, pageUrl);
}
