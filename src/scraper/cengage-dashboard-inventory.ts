import type { Page } from 'playwright';
import {
  extractDashboardCourses,
  extractDashboardCoursesFromCardCandidates,
  type CengageDashboardCardCandidate,
  type CengageDashboardCourse,
} from './cengage-courses';

export async function extractDashboardCourseInventory(
  page: Page
): Promise<CengageDashboardCourse[]> {
  const cardCandidates: CengageDashboardCardCandidate[] = await page.evaluate(
    () => {
      const normalizeText = (value: string | null | undefined): string =>
        (value || '').replace(/\s+/g, ' ').trim();

      const launchSelectorPriority = [
        'a.home-page-launch-course-link[href]',
        'a[data-test="home-page-launch-course-link"][href]',
        'a[data-test*="home-page-launch-course-link"][href]',
        'a[class*="home-page-launch-course-link"][href]',
      ];

      const fallbackLaunchPattern =
        /webassign|coursekey|mindtap|nglms|dashboard\/course|\/course\//i;

      const cards = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[id^="home-page-entitlement-card-"], [data-test*="home-page-entitlement-card"], [class*="home-page-entitlement-card"]'
        )
      );

      const seen = new Set<HTMLElement>();
      const uniqueCards = cards.filter((card) => {
        if (seen.has(card)) {
          return false;
        }

        seen.add(card);
        return true;
      });

      const results: CengageDashboardCardCandidate[] = [];

      for (const card of uniqueCards) {
        let launchAnchor: HTMLAnchorElement | null = null;

        for (const selector of launchSelectorPriority) {
          const matched = card.querySelector<HTMLAnchorElement>(selector);
          if (matched) {
            launchAnchor = matched;
            break;
          }
        }

        if (!launchAnchor) {
          launchAnchor =
            Array.from(
              card.querySelectorAll<HTMLAnchorElement>('a[href]')
            ).find((anchor) => {
              const href = anchor.getAttribute('href') || anchor.href || '';
              const text = normalizeText(anchor.textContent);
              const title = normalizeText(anchor.getAttribute('title'));
              const ariaLabel = normalizeText(
                anchor.getAttribute('aria-label')
              );
              const haystack = `${href} ${text} ${title} ${ariaLabel}`;
              return fallbackLaunchPattern.test(haystack);
            }) || null;
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
          '[data-test="home-page-title"], [data-test*="home-page-title"], .home-page-title, [class*="home-page-title"], h2, h3, [role="heading"]'
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
          launchAriaLabel: normalizeText(
            launchAnchor.getAttribute('aria-label')
          ),
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

      return results;
    }
  );

  const cardCourses = extractDashboardCoursesFromCardCandidates(
    cardCandidates,
    page.url()
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

  return extractDashboardCourses(candidates, page.url());
}
