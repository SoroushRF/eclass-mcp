import type { EClassBrowserSession } from './browser-session';
import { ECLASS_URL } from './browser-session';
import { checkSession } from './helpers';
import type { Grade } from './types';
import { getSelectorGroup, logDomSelectorMatch } from '../selectors';

const GOTO_OPTS = {
  waitUntil: 'domcontentloaded' as const,
  timeout: 30000,
};

export async function getGrades(
  session: EClassBrowserSession,
  courseId?: string
): Promise<Grade[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    const cid = courseId?.trim();
    const isOverview = !cid;
    const url = cid
      ? `${ECLASS_URL}/grade/report/user/index.php?id=${cid}`
      : `${ECLASS_URL}/grade/report/overview/index.php`;

    await page.goto(url, GOTO_OPTS);
    await checkSession(page);

    const selectorGroups = {
      overview: [
        ...getSelectorGroup('eclass.grades.overview_table').candidates,
      ],
      rows: [...getSelectorGroup('eclass.grades.user_rows').candidates],
    };
    const evaluated = await page.evaluate(
      ({
        cid,
        isOverviewMode,
        selectors,
      }: {
        cid: string | undefined;
        isOverviewMode: boolean;
        selectors: typeof selectorGroups;
      }) => {
        if (isOverviewMode) {
          let table: Element | null = null;
          let selectorMatch:
            | { candidateId: string; selector: string; count: number }
            | undefined;
          for (const candidate of selectors.overview) {
            const found = Array.from(
              document.querySelectorAll(candidate.selector)
            );
            if (found.length > 0) {
              table = found[0];
              selectorMatch = {
                candidateId: candidate.id,
                selector: candidate.selector,
                count: found.length,
              };
              break;
            }
          }
          if (!table) return { grades: [], selectorMatch };

          const rows = Array.from(table.querySelectorAll('tr')).slice(1);
          const grades = rows
            .map((r) => {
              const cells = Array.from(r.querySelectorAll('td'));
              if (cells.length < 2) return null;

              const link = cells[0].querySelector('a');
              const name =
                link?.textContent?.trim() ||
                cells[0].textContent?.trim() ||
                'Unknown Course';
              const gradeVal = cells[1].textContent?.trim() || '-';

              const href = link?.href || '';
              const idMatch = href.match(/[?&]id=(\d+)/);
              const extractedCid = idMatch ? idMatch[1] : '';

              return {
                courseId: extractedCid,
                itemName: name,
                grade: gradeVal,
                range: '-',
                percentage: '-',
                feedback: '',
              };
            })
            .filter(Boolean);
          return { grades, selectorMatch };
        } else {
          const rowCandidate = selectors.rows[0];
          const rows = Array.from(
            document.querySelectorAll(rowCandidate.selector)
          );
          const selectorMatch =
            rows.length > 0
              ? {
                  candidateId: rowCandidate.id,
                  selector: rowCandidate.selector,
                  count: rows.length,
                }
              : undefined;
          const grades = rows
            .map((r) => {
              const itemCell = r.querySelector('.column-itemname');
              const gradeCell = r.querySelector('.column-grade');
              if (!itemCell || !gradeCell) return null;

              let name = itemCell.textContent?.trim() || 'Item';
              name = name
                .replace(
                  /^(Manual item|Assignment|Quiz|Forum|Resource|Category|Grade item)\s*/i,
                  ''
                )
                .trim();

              return {
                courseId: cid || '',
                itemName: name,
                grade: gradeCell.textContent?.trim() || '-',
                range:
                  r.querySelector('.column-range')?.textContent?.trim() || '-',
                percentage:
                  r.querySelector('.column-percentage')?.textContent?.trim() ||
                  '-',
                feedback:
                  r.querySelector('.column-feedback')?.textContent?.trim() ||
                  '',
              };
            })
            .filter(
              (g) =>
                g !== null &&
                g.itemName &&
                g.itemName !== 'Grade item' &&
                g.itemName !== 'Category'
            );
          return { grades, selectorMatch };
        }
      },
      { cid, isOverviewMode: isOverview, selectors: selectorGroups }
    );

    if (evaluated.selectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.grades',
        groupId: isOverview
          ? 'eclass.grades.overview_table'
          : 'eclass.grades.user_rows',
        candidateId: evaluated.selectorMatch.candidateId,
        selector: evaluated.selectorMatch.selector,
        matchCount: evaluated.selectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }

    return (evaluated.grades as Grade[]).filter((g) => {
      if (!g) return false;
      if (isOverview) return g.grade !== '-';
      return true;
    });
  } finally {
    await page.close();
    await context.close();
  }
}
