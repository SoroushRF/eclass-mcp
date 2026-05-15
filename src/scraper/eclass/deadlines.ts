import type { EClassBrowserSession } from './browser-session';
import { ECLASS_URL } from './browser-session';
import { buildCourseMetadata, toDeadlineItem, checkSession } from './helpers';
import { getCourses } from './courses';
import type { Assignment, DeadlineItem } from './types';
import { getSelectorGroup, logDomSelectorMatch } from '../selectors';

export async function getDeadlines(
  session: EClassBrowserSession,
  courseId?: string
): Promise<Assignment[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    const url = courseId
      ? `${ECLASS_URL}/calendar/view.php?view=upcoming&course=${courseId}`
      : `${ECLASS_URL}/calendar/view.php?view=upcoming`;

    await page.goto(url, { waitUntil: 'networkidle' });
    await checkSession(page);

    const eventSelectors = [
      ...getSelectorGroup('eclass.calendar.upcoming_events').candidates,
    ];
    const evaluated = await page.evaluate((selectors) => {
      let events: Element[] = [];
      let selectorMatch:
        | {
            candidateId: string;
            selector: string;
            count: number;
          }
        | undefined;
      for (const candidate of selectors) {
        const found = Array.from(document.querySelectorAll(candidate.selector));
        if (found.length > 0) {
          events = found;
          selectorMatch = {
            candidateId: candidate.id,
            selector: candidate.selector,
            count: found.length,
          };
          break;
        }
      }

      const deadlines = events
        .map((ev) => {
          const title =
            ev.querySelector('h3.name')?.textContent?.trim() ||
            'Untitled Event';

          const actionLink = ev.querySelector(
            '.card-footer a.card-link'
          ) as HTMLAnchorElement;
          const url = actionLink?.href || '';

          const dateIcon = ev.querySelector('.fa-clock-o');
          const dateStr =
            dateIcon?.parentElement?.nextElementSibling?.textContent?.trim() ||
            '';

          const courseLink = ev.querySelector(
            'a[href*="course/view.php"]'
          ) as HTMLAnchorElement;
          const courseId =
            ev.getAttribute('data-course-id') ||
            courseLink?.href.match(/id=(\d+)/)?.[1] ||
            '';
          const courseName = courseLink?.textContent?.trim() || '';

          return {
            id: ev.getAttribute('data-event-id') || Math.random().toString(),
            name: title,
            dueDate: dateStr,
            status: 'Upcoming',
            ...{
              courseId,
              courseName,
              courseCode: '',
            },
            url,
          };
        })
        .filter(
          (d) => d.url && (d.url.includes('assign') || d.url.includes('quiz'))
        );
      return { deadlines, selectorMatch };
    }, eventSelectors);

    if (evaluated.selectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.calendar',
        groupId: 'eclass.calendar.upcoming_events',
        candidateId: evaluated.selectorMatch.candidateId,
        selector: evaluated.selectorMatch.selector,
        matchCount: evaluated.selectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }

    const deadlines = Array.isArray(evaluated)
      ? evaluated
      : evaluated.deadlines;

    return (deadlines as Assignment[]).map((item) => ({
      ...item,
      ...buildCourseMetadata(item.courseId, item.courseName),
    }));
  } finally {
    await page.close();
    await context.close();
  }
}

export async function getMonthDeadlines(
  session: EClassBrowserSession,
  month: number,
  year: number,
  courseId?: string
): Promise<DeadlineItem[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    const time = Math.floor(new Date(year, month - 1, 1).getTime() / 1000);
    const url = courseId
      ? `${ECLASS_URL}/calendar/view.php?view=month&time=${time}&course=${courseId}`
      : `${ECLASS_URL}/calendar/view.php?view=month&time=${time}`;

    await page.goto(url, { waitUntil: 'networkidle' });
    await checkSession(page);

    const monthEventSelectors = [
      ...getSelectorGroup('eclass.calendar.month_events').candidates,
    ];
    const evaluated = await page.evaluate((selectors) => {
      const eventEls: Element[] = [];
      let selectorMatch:
        | {
            candidateId: string;
            selector: string;
            count: number;
          }
        | undefined;
      const seen = new Set<Element>();
      for (const candidate of selectors) {
        const found = Array.from(document.querySelectorAll(candidate.selector));
        if (found.length > 0 && !selectorMatch) {
          selectorMatch = {
            candidateId: candidate.id,
            selector: candidate.selector,
            count: found.length,
          };
        }
        for (const element of found) {
          if (!seen.has(element)) {
            seen.add(element);
            eventEls.push(element);
          }
        }
      }

      const items = eventEls
        .map((el) => {
          const links = Array.from(
            el.querySelectorAll('a[href]')
          ) as HTMLAnchorElement[];
          const hrefs = links.map((a) => a.href).filter(Boolean);

          const preferred =
            hrefs.find((h) => h.includes('/mod/assign/')) ||
            hrefs.find((h) => h.includes('/mod/quiz/')) ||
            hrefs.find((h) => h.includes('assign')) ||
            hrefs.find((h) => h.includes('quiz')) ||
            hrefs.find((h) => h.includes('/calendar/')) ||
            hrefs[0] ||
            '';

          const url = preferred;

          const title =
            (
              el.querySelector(
                '.eventname, .name, .card-title, .calendar_event_name'
              )?.textContent ||
              links[0]?.textContent ||
              ''
            ).trim() || 'Untitled Event';

          const dateText =
            (el.querySelector('time') as HTMLTimeElement | null)?.getAttribute(
              'datetime'
            ) ||
            (el.querySelector('time') as HTMLTimeElement | null)?.textContent ||
            el.getAttribute('aria-label') ||
            '' ||
            el.textContent ||
            '';

          const courseLink = el.querySelector(
            'a[href*="course/view.php"]'
          ) as HTMLAnchorElement | null;
          const courseId =
            el.getAttribute('data-course-id') ||
            courseLink?.href.match(/id=(\d+)/)?.[1] ||
            '';

          const id =
            el.getAttribute('data-event-id') ||
            url.match(/[?&]id=(\d+)/)?.[1] ||
            Math.random().toString();

          return {
            id,
            name: title,
            dueDate: (dateText || '').trim(),
            status: 'Calendar',
            courseId,
            url,
          };
        })
        .filter((d) => d.url);
      return { items, selectorMatch };
    }, monthEventSelectors);

    if (evaluated.selectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.calendar',
        groupId: 'eclass.calendar.month_events',
        candidateId: evaluated.selectorMatch.candidateId,
        selector: evaluated.selectorMatch.selector,
        matchCount: evaluated.selectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }

    const items = Array.isArray(evaluated) ? evaluated : evaluated.items;

    return (items as Assignment[]).map(toDeadlineItem);
  } finally {
    await page.close();
    await context.close();
  }
}

export async function getAssignmentIndexDeadlines(
  session: EClassBrowserSession,
  courseId: string,
  courseName?: string
): Promise<DeadlineItem[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    const url = `${ECLASS_URL}/mod/assign/index.php?id=${courseId}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await checkSession(page);

    const rows = await page.evaluate(
      ({ cid, cname }) => {
        const headerCells = Array.from(
          document.querySelectorAll('.generaltable thead th')
        );
        const headers = headerCells.map((th) => (th.textContent || '').trim());
        const dataRows = Array.from(
          document.querySelectorAll('.generaltable tbody tr')
        );

        return dataRows
          .map((tr, idx) => {
            const tds = Array.from(tr.querySelectorAll('td'));
            const mapped: Record<string, string> = {};
            headers.forEach((h, i) => {
              mapped[h] = (tds[i]?.textContent || '')
                .trim()
                .replace(/\s+/g, ' ');
            });

            const link = tr.querySelector(
              'a[href*="/mod/assign/view.php?id="]'
            ) as HTMLAnchorElement | null;
            const href = link?.href || '';
            const name = (
              link?.textContent ||
              mapped['Assignments'] ||
              ''
            ).trim();
            if (!href || !name) return null;

            const idMatch = href.match(/[?&]id=(\d+)/);
            return {
              id: idMatch?.[1] || `${cid}_${idx}`,
              name,
              dueDate:
                mapped['Due date'] || mapped['Due Date'] || mapped['Due'] || '',
              status: mapped['Submission'] || 'Unknown',
              courseId: cid,
              courseName: cname || '',
              courseCode: '',
              url: href,
              type: 'assign' as const,
              section: mapped['Section'] || '',
              submission: mapped['Submission'] || '',
              grade: mapped['Grade'] || '',
            };
          })
          .filter(Boolean);
      },
      { cid: courseId, cname: courseName || '' }
    );

    return (rows as DeadlineItem[]).map((item) => ({
      ...item,
      ...buildCourseMetadata(item.courseId, item.courseName),
    }));
  } finally {
    await page.close();
    await context.close();
  }
}

export async function getAllAssignmentDeadlines(
  session: EClassBrowserSession,
  courseId?: string
): Promise<DeadlineItem[]> {
  if (courseId) {
    const courses = await getCourses(session).catch(() => []);
    const match = courses.find((course) => course.id === courseId);
    return getAssignmentIndexDeadlines(session, courseId, match?.name);
  }

  const courses = await getCourses(session);
  const all: DeadlineItem[] = [];
  for (const c of courses) {
    try {
      const items = await getAssignmentIndexDeadlines(session, c.id, c.name);
      all.push(...items);
    } catch {
      // Continue across courses; a single course failure should not fail all deadlines.
    }
  }
  return all;
}
