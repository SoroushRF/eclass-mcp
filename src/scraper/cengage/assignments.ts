import type { Page } from 'playwright';
import {
  ASSIGNMENT_CONTAINER_SELECTORS,
  ASSIGNMENT_DUE_DATE_SELECTORS,
  ASSIGNMENT_NAME_SELECTORS,
  ASSIGNMENT_ROW_SELECTORS,
  ASSIGNMENT_SCORE_SELECTORS,
  ASSIGNMENT_STATUS_SELECTORS,
  type CengageAssignmentRowCandidate,
} from '../cengage-assignment-parser';

export async function extractAssignmentRowCandidates(
  page: Page
): Promise<CengageAssignmentRowCandidate[]> {
  return page.evaluate(
    ({
      containerSelectors,
      rowSelectors,
      nameSelectors,
      dueDateSelectors,
      scoreSelectors,
      statusSelectors,
    }) => {
      const normalizeText = (value: string | null | undefined): string =>
        (value || '').replace(/\s+/g, ' ').trim();

      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }

        const rect = htmlElement.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const uniqueElements = (elements: Element[]): Element[] => {
        const seen = new Set<Element>();
        const unique: Element[] = [];

        for (const element of elements) {
          if (!seen.has(element)) {
            seen.add(element);
            unique.push(element);
          }
        }

        return unique;
      };

      const containers: Element[] = [];
      for (const selector of containerSelectors) {
        for (const match of Array.from(document.querySelectorAll(selector))) {
          if (isVisible(match)) {
            containers.push(match);
          }
        }
      }

      if (containers.length === 0) {
        const headings = Array.from(
          document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')
        );

        for (const heading of headings) {
          const headingText = normalizeText(heading.textContent).toLowerCase();
          if (!headingText.includes('assignment')) continue;

          const region = heading.closest('section, article, main, div');
          if (region && isVisible(region)) {
            containers.push(region);
          }
        }
      }

      const rows: CengageAssignmentRowCandidate[] = [];
      const uniqueContainers = uniqueElements(containers);

      for (const container of uniqueContainers) {
        const rowCandidates: Element[] = [];

        for (const selector of rowSelectors) {
          for (const row of Array.from(container.querySelectorAll(selector))) {
            rowCandidates.push(row);
          }
        }

        const uniqueRows = uniqueElements(rowCandidates);

        for (const row of uniqueRows) {
          const rowText = normalizeText(row.textContent);
          if (!rowText || rowText.length < 12) continue;

          const lowerRowText = rowText.toLowerCase();
          const hasAssignmentSignals =
            lowerRowText.includes('due date') ||
            lowerRowText.includes('assignment') ||
            lowerRowText.includes('submitted') ||
            lowerRowText.includes('not submitted') ||
            lowerRowText.includes('past due') ||
            lowerRowText.includes('score') ||
            lowerRowText.includes('points') ||
            lowerRowText.includes('grade');

          if (!hasAssignmentSignals) continue;

          let name = '';
          for (const selector of nameSelectors) {
            const element = row.querySelector(selector);
            if (!element) continue;

            const value = normalizeText(element.textContent);
            if (value) {
              name = value;
              break;
            }
          }

          if (!name) {
            name = normalizeText(rowText.split(/due\s*date/i)[0]);
          }

          if (!name || name.toLowerCase() === 'due date') continue;

          let dueDate = '';
          for (const selector of dueDateSelectors) {
            const element = row.querySelector(selector);
            if (!element) continue;

            const value = normalizeText(element.textContent);
            if (value) {
              dueDate = value;
              break;
            }
          }

          let score = '';
          for (const selector of scoreSelectors) {
            const element = row.querySelector(selector);
            if (!element) continue;

            const value = normalizeText(element.textContent);
            if (value) {
              score = value;
              break;
            }
          }

          let statusHint = '';
          for (const selector of statusSelectors) {
            const element = row.querySelector(selector);
            if (!element) continue;

            const value = normalizeText(element.textContent);
            if (value) {
              statusHint = value;
              break;
            }
          }

          const link = row.querySelector<HTMLAnchorElement>('a[href]');
          const href = normalizeText(
            (link?.getAttribute('href') || link?.href || '').toString()
          );

          const assignmentId = normalizeText(
            row.getAttribute('data-assignment-id') ||
              row.getAttribute('data-id') ||
              row.id ||
              ''
          );

          rows.push({
            id: assignmentId || undefined,
            href: href || undefined,
            name,
            dueDate: dueDate || undefined,
            score: score || undefined,
            statusHint: statusHint || undefined,
            rowText,
          });
        }
      }

      return rows;
    },
    {
      containerSelectors: [...ASSIGNMENT_CONTAINER_SELECTORS],
      rowSelectors: [...ASSIGNMENT_ROW_SELECTORS],
      nameSelectors: [...ASSIGNMENT_NAME_SELECTORS],
      dueDateSelectors: [...ASSIGNMENT_DUE_DATE_SELECTORS],
      scoreSelectors: [...ASSIGNMENT_SCORE_SELECTORS],
      statusSelectors: [...ASSIGNMENT_STATUS_SELECTORS],
    }
  );
}
