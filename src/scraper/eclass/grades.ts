import type { EClassBrowserSession } from './browser-session';
import { ECLASS_URL } from './browser-session';
import type { Grade } from './types';

export async function getGrades(
  session: EClassBrowserSession,
  courseId?: string
): Promise<Grade[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    const isOverview = !courseId;
    const url = courseId
      ? `${ECLASS_URL}/grade/report/user/index.php?id=${courseId}`
      : `${ECLASS_URL}/grade/report/overview/index.php`;

    await page.goto(url, { waitUntil: 'networkidle' });

    const grades = await page.evaluate(
      ({
        cid,
        isOverviewMode,
      }: {
        cid: string | undefined;
        isOverviewMode: boolean;
      }) => {
        if (isOverviewMode) {
          const table = document.querySelector(
            '.generaltable, #overview-grade, .user-grade'
          );
          if (!table) return [];

          const rows = Array.from(table.querySelectorAll('tr')).slice(1);
          return rows
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
        } else {
          const rows = Array.from(document.querySelectorAll('tr'));
          return rows
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
                  r.querySelector('.column-feedback')?.textContent?.trim() || '',
              };
            })
            .filter(
              (g) =>
                g !== null &&
                g.itemName &&
                g.itemName !== 'Grade item' &&
                g.itemName !== 'Category'
            );
        }
      },
      { cid: courseId, isOverviewMode: isOverview }
    );

    return (grades as Grade[]).filter((g) => {
      if (!g) return false;
      if (isOverview) return g.grade !== '-';
      return true;
    });
  } finally {
    await page.close();
    await context.close();
  }
}
