import type { EClassBrowserSession } from './browser-session';
import { extractCourseCode, checkSession } from './helpers';
import { ECLASS_URL } from './browser-session';
import { Course, CourseContent, SessionExpiredError } from './types';

export async function getCourses(
  session: EClassBrowserSession
): Promise<Course[]> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    await page.goto(`${ECLASS_URL}/my/courses.php`, {
      waitUntil: 'networkidle',
    });

    await checkSession(page);

    await page
      .waitForSelector('.course-listitem, .coursebox, .card-body', {
        timeout: 10000,
      })
      .catch(() => null);

    const courses = await page.evaluate(() => {
      const selectors = [
        '.course-listitem .coursename',
        '.coursebox .coursename a',
        '.card-body .coursename',
        '.course_title a',
      ];

      let items: Element[] = [];
      for (const s of selectors) {
        const found = Array.from(document.querySelectorAll(s));
        if (found.length > 0) {
          items = found;
          break;
        }
      }

      return items
        .map((el) => {
          const link = (
            el instanceof HTMLAnchorElement ? el : el.querySelector('a')
          ) as HTMLAnchorElement;
          const url = link?.href || '';
          const match = url.match(/id=(\d+)/);

          let name = el.textContent?.trim() || 'Unknown Course';
          name = name
            .replace(/Course is starred/g, '')
            .replace(/Course name/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          return {
            id: match ? match[1] : '',
            name,
            courseCode: '',
            url,
          };
        })
        .filter((c) => c.id);
    });

    const enrichedCourses = courses.map((course) => ({
      ...course,
      courseCode: extractCourseCode(course.name),
    }));

    if (courses.length === 0) await session.dumpPage(page, 'dashboard_empty');
    return enrichedCourses;
  } finally {
    await page.close();
    await context.close();
  }
}

export async function getCourseContent(
  session: EClassBrowserSession,
  courseId: string
): Promise<CourseContent> {
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    await page.goto(`${ECLASS_URL}/course/view.php?id=${courseId}`, {
      waitUntil: 'networkidle',
    });

    const indexSectionsData = await page.evaluate(() => {
      const indexBlocks = document.querySelectorAll('.courseindex-section');
      if (indexBlocks.length > 0) {
        return Array.from(indexBlocks)
          .map((sec) => {
            const title =
              sec
                .querySelector('.courseindex-section-title .courseindex-link')
                ?.textContent?.trim() || 'Topic / Week';
            const links = Array.from(
              sec.querySelectorAll('.courseindex-item a.courseindex-link')
            );

            const items = links
              .map((a) => {
                const href = (a as HTMLAnchorElement).href;
                let type: 'resource' | 'assign' | 'announcement' | 'other' =
                  'other';
                if (href.includes('resource')) type = 'resource';
                else if (href.includes('assign')) type = 'assign';
                else if (href.includes('forum')) type = 'announcement';

                return {
                  type,
                  name: a.textContent?.trim() || 'Item',
                  url: href,
                };
              })
              .filter((i) => i.url);

            return { title, items };
          })
          .filter((s) => s.items.length > 0);
      }
      return null;
    });

    if (indexSectionsData && indexSectionsData.length > 0) {
      return { courseId, sections: indexSectionsData as any };
    }

    const isOneSectionPerPage = await page.evaluate(() => {
      const modules = document.querySelectorAll(
        '.activityinstance a, .activity-item a'
      );
      const sections = document.querySelectorAll(
        'a[href*="course/view.php?id="][href*="&section="]'
      );
      return modules.length === 0 && sections.length > 0;
    });

    let sectionsData;

    if (isOneSectionPerPage) {
      const sectionLinks = await page.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll(
            'a[href*="course/view.php?id="][href*="&section="]'
          )
        ) as HTMLAnchorElement[];
        return Array.from(new Set(links.map((a) => a.href)));
      });

      const gatheredSections: any[] = [];
      for (const link of sectionLinks) {
        try {
          await page.goto(link, { waitUntil: 'load' });
          const sec = await page.evaluate(() => {
            const title =
              document
                .querySelector('h2, .sectionname, h3')
                ?.textContent?.trim() || 'Topic / Week';
            const moduleLinkEls = Array.from(
              document.querySelectorAll('.activityinstance a, .activity-item a')
            );

            const items = moduleLinkEls
              .map((a) => {
                const href = (a as HTMLAnchorElement).href;
                let type: 'resource' | 'assign' | 'announcement' | 'other' =
                  'other';
                if (href.includes('resource')) type = 'resource';
                else if (href.includes('assign')) type = 'assign';
                else if (href.includes('forum')) type = 'announcement';

                return {
                  type,
                  name:
                    a.querySelector('.instancename, .activityname')
                      ?.textContent?.trim() ||
                    a.textContent?.trim() ||
                    'Item',
                  url: href,
                };
              })
              .filter((i) => i.url);
            return { title, items };
          });
          if (sec.items.length > 0) gatheredSections.push(sec);
        } catch {
          // Ignore single section load failures
        }
      }
      sectionsData = gatheredSections;
    } else {
      sectionsData = await page.evaluate(() => {
        const sectionEls = Array.from(
          document.querySelectorAll('.section, .course-section')
        );

        return sectionEls
          .map((s) => {
            const title =
              s.querySelector('.sectionname, h3')?.textContent?.trim() ||
              'General';
            const moduleLinkEls = Array.from(
              s.querySelectorAll('.activityinstance a, .activity-item a')
            );

            const items = moduleLinkEls
              .map((a) => {
                const href = (a as HTMLAnchorElement).href;
                let type: 'resource' | 'assign' | 'announcement' | 'other' =
                  'other';

                if (href.includes('resource')) type = 'resource';
                else if (href.includes('assign')) type = 'assign';
                else if (href.includes('forum')) type = 'announcement';

                return {
                  type,
                  name:
                    a.querySelector('.instancename, .activityname')
                      ?.textContent?.trim() ||
                    a.textContent?.trim() ||
                    'Item',
                  url: href,
                };
              })
              .filter((i) => i.url);

            return { title, items };
          })
          .filter((s) => s.items.length > 0);
      });
    }

    return { courseId, sections: sectionsData as any };
  } finally {
    await page.close();
    await context.close();
  }
}
