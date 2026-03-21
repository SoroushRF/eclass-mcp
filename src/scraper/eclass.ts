import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { loadSession } from './session';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { DeadlineItem, DeadlineItemType, AssignmentDetails, QuizDetails, ItemDetails } from '../types/deadlines';


dotenv.config({ quiet: true });

const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';

export interface Course {
  id: string;
  name: string;
  courseCode?: string;
  url: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  author: string;
  discussionUrl?: string; // Add optional discussion URL
}

export interface SectionTextData {
  url: string;
  title: string;
  mainText: string;
  mainLinks: Array<{ name: string; url: string }>;
  tabs: Array<{ title: string; content: string; links: Array<{ name: string; url: string }> }>;
}

export interface Assignment {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  url: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractCourseCode(name?: string): string | undefined {
  if (!name) return undefined;

  const normalized = normalizeWhitespace(name);
  const patterns = [
    /\b([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\b/,
    /\b([A-Z]{2,5}\s\d{3,4}\s?[A-Z]?)\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, '');
    }
  }

  return undefined;
}

function buildCourseMetadata(courseId: string, courseName?: string) {
  const cleanName = courseName ? normalizeWhitespace(courseName) : undefined;
  return {
    courseId,
    courseName: cleanName || undefined,
    courseCode: extractCourseCode(cleanName),
  };
}

function inferItemType(url: string): DeadlineItemType {
  const u = url.toLowerCase();
  if (u.includes('/mod/assign/')) return 'assign';
  if (u.includes('/mod/quiz/')) return 'quiz';
  if (u.includes('assign')) return 'assign';
  if (u.includes('quiz')) return 'quiz';
  return 'other';
}

function toDeadlineItem(a: Assignment): DeadlineItem {
  return { ...a, type: inferItemType(a.url) };
}

export interface Grade {
  courseId: string;
  itemName: string;
  grade: string;
  range: string;
  percentage: string;
  feedback: string;
}

export interface FileItem {
  id: string;
  name: string;
  url: string;
  type: 'pdf' | 'docx' | 'pptx' | 'other';
}

export interface CourseContent {
  courseId: string;
  sections: {
    title: string;
    items: {
      type: 'resource' | 'assign' | 'announcement' | 'other';
      name: string;
      url: string;
    }[];
  }[];
}

export class SessionExpiredError extends Error {
  constructor() {
    super('eClass session expired or invalid. Please re-authenticate at http://localhost:3000/auth');
    this.name = 'SessionExpiredError';
  }
}

class EClassScraper {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          // Suppress the AutomationControlled feature flag that WAF fingerprinting checks
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
        ],
      });
    }
    return this.browser;
  }

  private async getAuthenticatedContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const cookies = loadSession();
    if (!cookies || cookies.length === 0) {
      throw new SessionExpiredError();
    }
    const context = await browser.newContext({
      // Mimic a real Chrome on Windows — WAF bot detection checks UA heavily
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-CA',
    });
    // Remove navigator.webdriver flag — the #1 headless indicator WAF checks
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Spoof plugin count (0 plugins = dead giveaway for headless)
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
    await context.addCookies(cookies);
    return context;
  }

  /**
   * Diagnostic helper to save HTML for debugging selectors
   */
  private async dumpPage(page: Page, name: string) {
    const debugDir = path.join(process.cwd(), '.eclass-mcp', 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    const html = await page.content();
    fs.writeFileSync(path.join(debugDir, `${name}.html`), html);
    console.error(`Dumped page to ${name}.html for debugging.`);
  }

  async getCourses(): Promise<Course[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(`${ECLASS_URL}/my/courses.php`, { waitUntil: 'networkidle' });
      
      // Wait for either the dashboard list or login redirect
      if (page.url().includes('login')) {
        throw new SessionExpiredError();
      }

      // Selector for Moodle 4.x dashboard course cards
      // Often .course-listitem, .course-info-container, or specific York selectors
      await page.waitForSelector('.course-listitem, .coursebox, .card-body', { timeout: 10000 }).catch(() => null);
      
      const courses = await page.evaluate(() => {
        // Try several common Moodle course list selectors
        const selectors = [
          '.course-listitem .coursename', // Moodle 4 Dashboard
          '.coursebox .coursename a',      // Older Moodle style
          '.card-body .coursename',       // Cards style
          '.course_title a'                // Some custom variations
        ];

        let items: Element[] = [];
        for (const s of selectors) {
          const found = Array.from(document.querySelectorAll(s));
          if (found.length > 0) {
            items = found;
            break;
          }
        }

        return items.map(el => {
          const link = (el instanceof HTMLAnchorElement ? el : el.querySelector('a')) as HTMLAnchorElement;
          const url = link?.href || '';
          const match = url.match(/id=(\d+)/);
          
          let name = el.textContent?.trim() || 'Unknown Course';
          // Clean up accessibility boilerplate common in Moodle 4
          name = name.replace(/Course is starred/g, '')
                     .replace(/Course name/g, '')
                     .replace(/\s+/g, ' ')
                     .trim();

          return {
            id: match ? match[1] : '',
            name: name,
            courseCode: '',
            url: url
          };
        }).filter(c => c.id);
      });

      const enrichedCourses = courses.map((course) => ({
        ...course,
        courseCode: extractCourseCode(course.name),
      }));

      if (courses.length === 0) await this.dumpPage(page, 'dashboard_empty');
      return enrichedCourses;
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getCourseContent(courseId: string): Promise<CourseContent> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(`${ECLASS_URL}/course/view.php?id=${courseId}`, { waitUntil: 'networkidle' });

      // Strategy 1: The Moodle 4 Course Index Sidebar
      // This is the most reliable source because it ignores all weird Grid/Tab/Section templates
      // and just lists the full raw course tree universally.
      const indexSectionsData = await page.evaluate(() => {
        const indexBlocks = document.querySelectorAll('.courseindex-section');
        if (indexBlocks.length > 0) {
          return Array.from(indexBlocks).map(sec => {
            const title = sec.querySelector('.courseindex-section-title .courseindex-link')?.textContent?.trim() || 'Topic / Week';
            const links = Array.from(sec.querySelectorAll('.courseindex-item a.courseindex-link'));
            
            const items = links.map(a => {
              const href = (a as HTMLAnchorElement).href;
              let type: 'resource' | 'assign' | 'announcement' | 'other' = 'other';
              if (href.includes('resource')) type = 'resource';
              else if (href.includes('assign')) type = 'assign';
              else if (href.includes('forum')) type = 'announcement';
              
              return {
                type,
                name: a.textContent?.trim() || 'Item',
                url: href
              };
            }).filter(i => i.url);

            return { title, items };
          }).filter(s => s.items.length > 0);
        }
        return null;
      });

      if (indexSectionsData && indexSectionsData.length > 0) {
        return { courseId, sections: indexSectionsData as any };
      }

      // Strategy 2: Check if this course uses "One section per page" format
      const isOneSectionPerPage = await page.evaluate(() => {
        const modules = document.querySelectorAll('.activityinstance a, .activity-item a');
        const sections = document.querySelectorAll('a[href*="course/view.php?id="][href*="&section="]');
        return modules.length === 0 && sections.length > 0;
      });

      let sectionsData;

      if (isOneSectionPerPage) {
        // Collect unique section links
        const sectionLinks = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href*="course/view.php?id="][href*="&section="]')) as HTMLAnchorElement[];
          return Array.from(new Set(links.map(a => a.href)));
        });

        const gatheredSections: any[] = [];
        for (const link of sectionLinks) {
          try {
            await page.goto(link, { waitUntil: 'load' });
            const sec = await page.evaluate(() => {
              const title = document.querySelector('h2, .sectionname, h3')?.textContent?.trim() || 'Topic / Week';
              const moduleLinkEls = Array.from(document.querySelectorAll('.activityinstance a, .activity-item a'));
              
              const items = moduleLinkEls.map(a => {
                const href = (a as HTMLAnchorElement).href;
                let type: 'resource' | 'assign' | 'announcement' | 'other' = 'other';
                if (href.includes('resource')) type = 'resource';
                else if (href.includes('assign')) type = 'assign';
                else if (href.includes('forum')) type = 'announcement';
                
                return {
                  type,
                  name: a.querySelector('.instancename, .activityname')?.textContent?.trim() || a.textContent?.trim() || 'Item',
                  url: href
                };
              }).filter(i => i.url);
              return { title, items };
            });
            if (sec.items.length > 0) gatheredSections.push(sec);
          } catch (err) {
            // Ignore single section load failures
          }
        }
        sectionsData = gatheredSections;
      } else {
        // Selectors for normal single-page sections and their modules
        sectionsData = await page.evaluate(() => {
          const sectionEls = Array.from(document.querySelectorAll('.section, .course-section'));
          
          return sectionEls.map(s => {
            const title = s.querySelector('.sectionname, h3')?.textContent?.trim() || 'General';
            const moduleLinkEls = Array.from(s.querySelectorAll('.activityinstance a, .activity-item a'));
            
            const items = moduleLinkEls.map(a => {
              const href = (a as HTMLAnchorElement).href;
              let type: 'resource' | 'assign' | 'announcement' | 'other' = 'other';
              
              if (href.includes('resource')) type = 'resource';
              else if (href.includes('assign')) type = 'assign';
              else if (href.includes('forum')) type = 'announcement';

              return {
                type,
                name: a.querySelector('.instancename, .activityname')?.textContent?.trim() || a.textContent?.trim() || 'Item',
                url: href
              };
            }).filter(i => i.url);

            return { title, items };
          }).filter(s => s.items.length > 0);
        });
      }

      return { courseId, sections: sectionsData as any };
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getDeadlines(courseId?: string): Promise<Assignment[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      const url = courseId 
        ? `${ECLASS_URL}/calendar/view.php?view=upcoming&course=${courseId}`
        : `${ECLASS_URL}/calendar/view.php?view=upcoming`;
        
      await page.goto(url, { waitUntil: 'networkidle' });
      
      const deadlines = await page.evaluate(() => {
        const events = Array.from(document.querySelectorAll('.event'));
        return events.map(ev => {
          // New Moodle 4 / Moove theme Card structure
          const title = ev.querySelector('h3.name')?.textContent?.trim() || 'Untitled Event';
          
          // The link to the actual assignment is usually in the footer button
          const actionLink = ev.querySelector('.card-footer a.card-link') as HTMLAnchorElement;
          const url = actionLink?.href || '';
          
          // Date is now in a div next to the clock icon
          const dateIcon = ev.querySelector('.fa-clock-o');
          const dateStr = dateIcon?.parentElement?.nextElementSibling?.textContent?.trim() || '';
          
          // Course info
          const courseLink = ev.querySelector('a[href*="course/view.php"]') as HTMLAnchorElement;
          const courseId = ev.getAttribute('data-course-id') || courseLink?.href.match(/id=(\d+)/)?.[1] || '';
          const courseName = courseLink?.textContent?.trim() || '';
          
          return {
            id: ev.getAttribute('data-event-id') || Math.random().toString(),
            name: title,
            dueDate: dateStr,
            status: 'Upcoming',
            ...({
              courseId,
              courseName,
              courseCode: '',
            }),
            url: url
          };
        }).filter(d => d.url && (d.url.includes('assign') || d.url.includes('quiz')));
      });

      return (deadlines as Assignment[]).map((item) => ({
        ...item,
        ...buildCourseMetadata(item.courseId, item.courseName),
      }));
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getMonthDeadlines(month: number, year: number, courseId?: string): Promise<DeadlineItem[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      const time = Math.floor(new Date(year, month - 1, 1).getTime() / 1000);
      const url = courseId
        ? `${ECLASS_URL}/calendar/view.php?view=month&time=${time}&course=${courseId}`
        : `${ECLASS_URL}/calendar/view.php?view=month&time=${time}`;

      await page.goto(url, { waitUntil: 'networkidle' });

      const items = await page.evaluate(() => {
        const eventEls = Array.from(document.querySelectorAll('.calendar_event_course, .calendar_event, .event'));

        return eventEls.map((el) => {
          const links = Array.from(el.querySelectorAll('a[href]')) as HTMLAnchorElement[];
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
            (el.querySelector('.eventname, .name, .card-title, .calendar_event_name')?.textContent ||
              links[0]?.textContent ||
              '').trim() ||
            'Untitled Event';

          // Month view date can be in time tags or aria labels; fall back to whatever text we can find.
          const dateText =
            (el.querySelector('time') as HTMLTimeElement | null)?.getAttribute('datetime') ||
            (el.querySelector('time') as HTMLTimeElement | null)?.textContent ||
            (el.getAttribute('aria-label') || '') ||
            (el.textContent || '');

          const courseLink = el.querySelector('a[href*="course/view.php"]') as HTMLAnchorElement | null;
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
        }).filter(d => d.url);
      });

      return (items as Assignment[]).map(toDeadlineItem);
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getAssignmentIndexDeadlines(courseId: string, courseName?: string): Promise<DeadlineItem[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      const url = `${ECLASS_URL}/mod/assign/index.php?id=${courseId}`;
      await page.goto(url, { waitUntil: 'networkidle' });

      const rows = await page.evaluate(({ cid, cname }) => {
        const headerCells = Array.from(document.querySelectorAll('.generaltable thead th'));
        const headers = headerCells.map((th) => (th.textContent || '').trim());
        const dataRows = Array.from(document.querySelectorAll('.generaltable tbody tr'));

        return dataRows.map((tr, idx) => {
          const tds = Array.from(tr.querySelectorAll('td'));
          const mapped: Record<string, string> = {};
          headers.forEach((h, i) => {
            mapped[h] = (tds[i]?.textContent || '').trim().replace(/\s+/g, ' ');
          });

          const link = tr.querySelector('a[href*="/mod/assign/view.php?id="]') as HTMLAnchorElement | null;
          const href = link?.href || '';
          const name = (link?.textContent || mapped['Assignments'] || '').trim();
          if (!href || !name) return null;

          const idMatch = href.match(/[?&]id=(\d+)/);
          return {
            id: idMatch?.[1] || `${cid}_${idx}`,
            name,
            dueDate: mapped['Due date'] || mapped['Due Date'] || mapped['Due'] || '',
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
        }).filter(Boolean);
      }, { cid: courseId, cname: courseName || '' });

      return (rows as DeadlineItem[]).map((item) => ({
        ...item,
        ...buildCourseMetadata(item.courseId, item.courseName),
      }));
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getAllAssignmentDeadlines(courseId?: string): Promise<DeadlineItem[]> {
    if (courseId) {
      const courses = await this.getCourses().catch(() => []);
      const match = courses.find((course) => course.id === courseId);
      return this.getAssignmentIndexDeadlines(courseId, match?.name);
    }

    const courses = await this.getCourses();
    const all: DeadlineItem[] = [];
    for (const c of courses) {
      try {
        const items = await this.getAssignmentIndexDeadlines(c.id, c.name);
        all.push(...items);
      } catch {
        // Continue across courses; a single course failure should not fail all deadlines.
      }
    }
    return all;
  }

  async getItemDetails(url: string): Promise<ItemDetails> {
    const t = inferItemType(url);
    if (t === 'quiz') return this.getQuizDetails(url);
    return this.getAssignmentDetails(url);
  }

  async getAssignmentDetails(url: string): Promise<AssignmentDetails> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const data = await page.evaluate((pageUrl) => {
        const title =
          (document.querySelector('h1')?.textContent || document.title || '').trim() ||
          'Assignment';

        const descEl =
          (document.querySelector('.no-overflow') as HTMLElement | null) ||
          (document.querySelector('#intro .no-overflow') as HTMLElement | null) ||
          (document.querySelector('#intro') as HTMLElement | null);

        const descriptionHtml = descEl?.innerHTML?.trim() || '';
        const descriptionText = descEl?.textContent?.trim() || '';

        // Extract instruction screenshot URLs (vision-only; no OCR).
        const descriptionImageUrls: string[] = [];
        if (descEl) {
          const imgs = Array.from(descEl.querySelectorAll('img[src]')) as HTMLImageElement[];
          for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            if (!src) continue;
            try {
              descriptionImageUrls.push(new URL(src, pageUrl).href);
            } catch {
              // ignore invalid URLs
            }
          }
        }
        const descriptionImageUrlsUnique = Array.from(new Set(descriptionImageUrls));

        const descriptionImageSet = new Set(descriptionImageUrlsUnique);

        // Extract downloadable resources linked from the page.
        const pluginAnchors = Array.from(document.querySelectorAll('a[href*="pluginfile.php"]')) as HTMLAnchorElement[];
        const attachments: Array<{ url: string; kind: any; name?: string; hint?: string }> = [];

        const classifyKind = (href: string): any => {
          const h = href.toLowerCase();
          if (h.includes('.pdf')) return 'pdf';
          if (h.includes('.docx')) return 'docx';
          if (h.includes('.pptx')) return 'pptx';
          if (h.match(/\.(png|jpe?g|gif|webp)(\?|#|$)/i)) return 'image';
          if (h.includes('.csv')) return 'csv';
          return 'other';
        };

        for (const a of pluginAnchors) {
          const href = a.href || a.getAttribute('href') || '';
          if (!href) continue;
          let abs = href;
          try {
            abs = new URL(href, pageUrl).href;
          } catch {
            // ignore
          }

          // Don't double-count instruction screenshots as attachments.
          if (descriptionImageSet.has(abs)) continue;

          if (attachments.length >= 20) break;

          const name = (a.textContent || '').trim() || '';
          const kind = classifyKind(abs);
          attachments.push({
            url: abs,
            kind,
            name: name || undefined,
            hint: 'downloadable resource'
          });
        }

        const uniqueAttachments: Array<{ url: string; kind: any; name?: string; hint?: string }> = [];
        const seen = new Set<string>();
        for (const att of attachments) {
          if (seen.has(att.url)) continue;
          seen.add(att.url);
          uniqueAttachments.push(att);
        }

        const table = document.querySelector('.submissionstatustable') as HTMLTableElement | null;
        const fields: Record<string, string> = {};
        if (table) {
          const rows = Array.from(table.querySelectorAll('tr'));
          for (const r of rows) {
            const k = (r.querySelector('th')?.textContent || '').trim();
            const v = (r.querySelector('td')?.textContent || '').trim();
            if (k) fields[k] = v;
          }
        }

        // Try to derive grade/feedback from the table when present.
        const grade =
          fields['Grade'] ||
          fields['Grading status'] ||
          '';

        const feedbackText =
          fields['Feedback'] ||
          '';

        return {
          kind: 'assign' as const,
          url: pageUrl,
          title,
          descriptionHtml: descriptionHtml || undefined,
          descriptionText: descriptionText || undefined,
          descriptionImageUrls: descriptionImageUrlsUnique.length ? descriptionImageUrlsUnique : undefined,
          attachments: uniqueAttachments.length ? (uniqueAttachments as any) : undefined,
          fields: Object.keys(fields).length ? fields : undefined,
          grade: grade || undefined,
          feedbackText: feedbackText || undefined,
        };
      }, url);

      return data;
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getQuizDetails(url: string): Promise<QuizDetails> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const data = await page.evaluate((pageUrl) => {
        const title =
          (document.querySelector('h1')?.textContent || document.title || '').trim() ||
          'Quiz';

        const descEl =
          (document.querySelector('#intro .no-overflow') as HTMLElement | null) ||
          (document.querySelector('#intro') as HTMLElement | null) ||
          (document.querySelector('.no-overflow') as HTMLElement | null);

        const descriptionHtml = descEl?.innerHTML?.trim() || '';
        const descriptionText = descEl?.textContent?.trim() || '';

        // Extract quiz instruction screenshot URLs (vision-only; no OCR).
        const descriptionImageUrls: string[] = [];
        if (descEl) {
          const imgs = Array.from(descEl.querySelectorAll('img[src]')) as HTMLImageElement[];
          for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            if (!src) continue;
            try {
              descriptionImageUrls.push(new URL(src, pageUrl).href);
            } catch {
              // ignore invalid URLs
            }
          }
        }
        const descriptionImageUrlsUnique = Array.from(new Set(descriptionImageUrls));
        const descriptionImageSet = new Set(descriptionImageUrlsUnique);

        // Best-effort downloadable resources from quiz page.
        const pluginAnchors = Array.from(document.querySelectorAll('a[href*="pluginfile.php"]')) as HTMLAnchorElement[];
        const attachments: Array<{ url: string; kind: any; name?: string; hint?: string }> = [];

        const classifyKind = (href: string): any => {
          const h = href.toLowerCase();
          if (h.includes('.pdf')) return 'pdf';
          if (h.includes('.docx')) return 'docx';
          if (h.includes('.pptx')) return 'pptx';
          if (h.match(/\.(png|jpe?g|gif|webp)(\?|#|$)/i)) return 'image';
          if (h.includes('.csv')) return 'csv';
          return 'other';
        };

        for (const a of pluginAnchors) {
          const href = a.href || a.getAttribute('href') || '';
          if (!href) continue;
          let abs = href;
          try {
            abs = new URL(href, pageUrl).href;
          } catch {
            // ignore
          }

          // Avoid double-counting instruction screenshots as attachments.
          if (descriptionImageSet.has(abs)) continue;
          if (attachments.length >= 20) break;

          const name = (a.textContent || '').trim() || '';
          const kind = classifyKind(abs);
          attachments.push({
            url: abs,
            kind,
            name: name || undefined,
            hint: 'downloadable resource'
          });
        }

        const uniqueAttachments: Array<{ url: string; kind: any; name?: string; hint?: string }> = [];
        const seen = new Set<string>();
        for (const att of attachments) {
          if (seen.has(att.url)) continue;
          seen.add(att.url);
          uniqueAttachments.push(att);
        }

        // Try to extract grade/score from the page text first. This is more robust
        // than our key/value table mapping because Moodle structures can vary.
        const pageText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();

        const num = `(\\d+(?:\\.\\d+)?)`;
        const highestGradeMatch = pageText.match(new RegExp(`Highest grade:\\s*${num}\\s*\\/\\s*${num}`, 'i'));
        const gradeToPassMatch = pageText.match(new RegExp(`Grade to pass:\\s*${num}\\s*out of\\s*${num}`, 'i'));
        const markPercentMatch = pageText.match(new RegExp(`(?:Mark|Score):\\s*${num}\\s*%`, 'i'));

        let grade: string | undefined;
        if (highestGradeMatch) {
          grade = `${highestGradeMatch[1]} / ${highestGradeMatch[2]}`;
        } else if (markPercentMatch) {
          grade = `${markPercentMatch[1]}%`;
        } else if (gradeToPassMatch) {
          // Fallback: at least we know grading rubric, even if the achieved grade
          // isn't visible in the summary.
          grade = `${gradeToPassMatch[1]} / ${gradeToPassMatch[2]} (to pass)`;
        }

        // Additionally, collect a small set of key/value facts from quizattemptsummary
        // when the DOM is accessible.
        const table =
          (document.querySelector('table.quizattemptsummary') as HTMLTableElement | null) ||
          (document.querySelector('table.generaltable.quizattemptsummary') as HTMLTableElement | null) ||
          (document.querySelector('.quizattemptsummary') as HTMLElement | null);

        const fields: Record<string, string> = {};
        const tableEl =
          table && table.tagName === 'TABLE'
            ? (table as HTMLTableElement)
            : table
              ? (table.querySelector('table') as HTMLTableElement | null)
              : null;

        if (tableEl) {
          const rows = Array.from(tableEl.querySelectorAll('tr'));
          for (const r of rows) {
            const cells = Array.from(r.querySelectorAll('th, td'))
              .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' '))
              .filter(Boolean);

            if (cells.length >= 2) {
              const k = cells[0];
              const v = cells.slice(1).join(' ').trim();
              if (k && v && (/(grade|mark|attempt|state)/i.test(k) || /\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?/.test(v))) {
                fields[k] = v;
              }
            }
          }
        }

        // If text-based grade failed, attempt to derive it from captured fields.
        if (!grade) {
          const candidateKeys = Object.keys(fields).filter((k) => /grade|mark/i.test(k));
          for (const k of candidateKeys) {
            const v = fields[k];
            if (/\d/.test(v) && (v.includes('/') || v.includes('%'))) {
              grade = v;
              break;
            }
          }
        }

        // Feedback is not always present in the summary HTML, so keep it optional.
        const feedbackMatch = pageText.match(/Feedback:\s*(.+?)(?:\n|$)/i);
        const feedbackText = feedbackMatch ? feedbackMatch[1].trim() : '';

        return {
          kind: 'quiz' as const,
          url: pageUrl,
          title,
          descriptionHtml: descriptionHtml || undefined,
          descriptionText: descriptionText || undefined,
          descriptionImageUrls: descriptionImageUrlsUnique.length ? descriptionImageUrlsUnique : undefined,
          attachments: uniqueAttachments.length ? (uniqueAttachments as any) : undefined,
          fields: Object.keys(fields).length ? fields : undefined,
          grade: grade || undefined,
          feedbackText: feedbackText || undefined,
        };
      }, url);

      return data;
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getGrades(courseId?: string): Promise<Grade[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      const url = courseId 
        ? `${ECLASS_URL}/grade/report/user/index.php?id=${courseId}`
        : `${ECLASS_URL}/grade/report/overview/index.php`;
        
      await page.goto(url, { waitUntil: 'networkidle' });
      
      const grades = await page.evaluate((cid) => {
        const rows = Array.from(document.querySelectorAll('tr.gradeitem, .user-grade tr'));
        return rows.map(r => {
          return {
            courseId: cid || '',
            itemName: r.querySelector('.column-itemname')?.textContent?.trim() || 'Item',
            grade: r.querySelector('.column-grade')?.textContent?.trim() || '-',
            range: r.querySelector('.column-range')?.textContent?.trim() || '-',
            percentage: r.querySelector('.column-percentage')?.textContent?.trim() || '-',
            feedback: r.querySelector('.column-feedback')?.textContent?.trim() || ''
          };
        }).filter(g => g.grade !== '-');
      }, courseId);

      return grades as Grade[];
    } finally {
      await page.close();
      await context.close();
    }
  }

  async getAnnouncements(courseId?: string, limit: number = 10): Promise<Announcement[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      let forumUrl = '';

      if (courseId) {
        // Step 1: Navigate to the course forum index to reliably find the "Announcements" or module ID
        await page.goto(`${ECLASS_URL}/mod/forum/index.php?id=${courseId}`, { waitUntil: 'networkidle' });
        
        forumUrl = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('.generaltable a[href*="mod/forum/view.php"]')) as HTMLAnchorElement[];
          // Try to find one named Announcements or News, otherwise take the first forum available.
          const target = links.find(l => /announcement|news|forum/i.test(l.textContent || '')) || links[0];
          return target ? target.href : '';
        });

        if (!forumUrl) {
          // Fallback if course has no forum index or we couldn't find one.
          forumUrl = `${ECLASS_URL}/course/view.php?id=${courseId}`; // Just try the course page or fail gracefully later.
        }
      } else {
        forumUrl = `${ECLASS_URL}/my/`;
      }

      await page.goto(forumUrl, { waitUntil: 'networkidle' });

      // If we are on a course page acting as a fallback, look for a forum link there
      if (forumUrl.includes('course/view')) {
         const foundLink = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="mod/forum/view.php"]')) as HTMLAnchorElement[];
            const target = links.find(l => /announcement|news|forum/i.test(l.textContent || '')) || links[0];
            return target?.href || '';
         });
         if (foundLink) {
           await page.goto(foundLink, { waitUntil: 'networkidle' });
         } else {
           return []; // No forum found
         }
      }

      // Step 2: Extract the List of Discussions
      const announcementsMeta = await page.evaluate(() => {
        const topics = Array.from(document.querySelectorAll('.topic, .discussion'));
        return topics.map(row => {
          // Classic Moodle or Moove theme support
          const titleLink = row.querySelector('.subject a, .topic-name a, th.topic a') as HTMLAnchorElement;
          
          let authorText = row.querySelector('.author')?.textContent?.trim() || '';
          if (!authorText) {
             const authorDiv = row.querySelectorAll('.author-info .text-truncate');
             if (authorDiv.length > 0) authorText = authorDiv[0].textContent?.trim() || '';
          }

          let dateText = row.querySelector('.lastpost date, .modified')?.textContent?.trim() || '';
          if (!dateText) {
             const times = row.querySelectorAll('time');
             if (times.length > 0) dateText = times[0].textContent?.trim() || '';
          }

          return {
            id: titleLink?.href.match(/[?&]d=(\d+)/)?.[1] || '',
            title: titleLink?.textContent?.trim() || 'Untitled',
            discussionUrl: titleLink?.href || '',
            date: dateText,
            author: authorText
          };
        }).filter(a => a.id && a.discussionUrl);
      });

      const topDiscussions = announcementsMeta.slice(0, limit);
      const results: Announcement[] = [];

      // Step 3: Fetch the POST BODY for each discussion
      for (const meta of topDiscussions) {
        let content = '';
        try {
          await page.goto(meta.discussionUrl, { waitUntil: 'networkidle' });
          content = await page.evaluate(() => {
            const post = document.querySelector('.forumpost, article.forum-post');
            if (!post) return '';
            const body = post.querySelector('.post-content-container, .posting') as HTMLElement;
            let text = body?.textContent || body?.innerText || '';
            return text.replace(/\n\s*\n/g, '\n').trim(); // clean up extra whitespace
          });
        } catch (err) {
          // ignore page navigation errors for a single post
        }

        results.push({
          id: meta.id,
          title: meta.title,
          content: content || 'Could not fetch content.',
          date: meta.date,
          author: meta.author,
          discussionUrl: meta.discussionUrl
        });
      }

      return results;
    } finally {
      await page.close();
      await context.close();
    }
  }

  async downloadFile(fileUrl: string): Promise<{ buffer: Buffer, mimeType: string, filename: string }> {
    const context = await this.getAuthenticatedContext();
    try {
      // --- Phase 1: Fast HTTP request (works for direct file URLs) ---
      let response = await context.request.get(fileUrl);
      let headers = response.headers();
      let mimeType = headers['content-type'] || 'application/octet-stream';
      let buffer = await response.body();

      if (mimeType.includes('text/html')) {
        const html = buffer.toString('utf-8');
        let directUrl: string | null = null;

        // Static regex patterns (work when Moodle returns non-JS-rendered HTML)
        // Pattern 1: Embedded object
        const objectMatch = html.match(/<object[^>]*data="([^"]+)"/i);
        if (objectMatch?.[1]) directUrl = objectMatch[1];

        // Pattern 2: Forced download link
        if (!directUrl) {
          const downloadMatch = html.match(/<div class="resourceworkaround"><a href="([^"]+)"/i);
          if (downloadMatch?.[1]) directUrl = downloadMatch[1];
        }

        // Pattern 3: Static iframe
        if (!directUrl) {
          const iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"/i);
          if (iframeMatch?.[1]) directUrl = iframeMatch[1];
        }

        // --- Phase 2: Full Playwright page with response interception ---
        // Moodle renders /mod/resource/view.php via JavaScript. The file often loads
        // inside an <iframe> or via a redirect chain — invisible to DOM inspection.
        // We intercept ALL network responses during page load and capture the first
        // non-HTML file (PDF, DOCX, PPTX) that flows through, regardless of frame depth.
        if (!directUrl) {
          const page = await context.newPage();
          try {
            let interceptedBuffer: Buffer | null = null;
            let interceptedMime = '';
            let interceptedFilename = '';

            page.on('response', async (res) => {
              // Skip if we already captured a file
              if (interceptedBuffer) return;

              const ct = res.headers()['content-type'] || '';
              const url = res.url();

              // Only care about responses that look like actual files
              const isFile =
                ct.includes('application/pdf') ||
                ct.includes('wordprocessingml') ||
                ct.includes('presentationml') ||
                ct.includes('application/octet-stream') ||
                url.includes('pluginfile.php');

              const isNoise =
                ct.includes('text/html') ||
                ct.includes('text/javascript') ||
                ct.includes('text/css') ||
                ct.includes('image/') ||
                ct.includes('font/');

              if (isFile && !isNoise) {
                try {
                  const body = await res.body();
                  if (body.length > 500) { // skip tiny/empty responses
                    interceptedBuffer = body;
                    interceptedMime = ct || 'application/octet-stream';
                    const cd = res.headers()['content-disposition'] || '';
                    const fnMatch = cd.match(/filename="?([^";\n]+)"?/);
                    interceptedFilename = fnMatch
                      ? decodeURIComponent(fnMatch[1].trim())
                      : path.basename(new URL(url).pathname);
                  }
                } catch { /* response body may be unavailable, skip */ }
              }
            });

            await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

            // Detect AWS WAF Bot Control challenge and wait for its auto-reload.
            // The challenge JS calls getToken() then window.location.reload() —
            // we need to wait for THAT second navigation to complete.
            const isWafChallenge = await page.evaluate(() =>
              typeof (window as any).awsWafCookieDomainList !== 'undefined'
            ).catch(() => false);

            if (isWafChallenge) {
              console.error('[downloadFile] WAF challenge detected — waiting for auto-reload...');
              try {
                // Wait for the challenge to complete and the page to reload
                await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 });
              } catch {
                console.error('[downloadFile] WAF challenge reload timed out — bot detection may have blocked us.');
              }
            } else {
              // No WAF, just wait for everything to settle
              await page.waitForLoadState('networkidle').catch(() => {});
            }

            if (interceptedBuffer) {
              await page.close();
      // Resolve extension from filename if mime is generic
              let resolvedMime = interceptedMime;
              const ext = path.extname(interceptedFilename).toLowerCase();
              if (resolvedMime === 'application/octet-stream') {
                if (ext === '.pdf') resolvedMime = 'application/pdf';
                else if (ext === '.docx') resolvedMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                else if (ext === '.pptx') resolvedMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        else if (ext === '.png') resolvedMime = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') resolvedMime = 'image/jpeg';
        else if (ext === '.gif') resolvedMime = 'image/gif';
        else if (ext === '.webp') resolvedMime = 'image/webp';
              }
              return { buffer: interceptedBuffer, mimeType: resolvedMime, filename: interceptedFilename };
            }

            // Response interception missed it — try reading the live DOM as last resort
            directUrl = await page.evaluate(() => {
              const obj = document.querySelector<HTMLObjectElement>('object[data]');
              if (obj?.data) return obj.data;
              const iframe = document.querySelector<HTMLIFrameElement>('iframe[src]');
              if (iframe?.src) return iframe.src;
              const workaround = document.querySelector<HTMLAnchorElement>(
                '.resourceworkaround a, a[href*="forcedownload=1"]'
              );
              if (workaround?.href) return workaround.href;
              const pluginLink = document.querySelector<HTMLAnchorElement>('a[href*="pluginfile.php"]');
              if (pluginLink?.href) return pluginLink.href;
              return null;
            });
          } finally {
            await page.close();
          }
        }

        if (directUrl) {
          const resolvedUrl = new URL(directUrl, fileUrl).toString();
          response = await context.request.get(resolvedUrl);
          headers = response.headers();
          mimeType = headers['content-type'] || 'application/octet-stream';
          buffer = await response.body();
        } else {
          throw new Error('Hit an HTML wrapper page but could not extract a direct file URL even after JS rendering.');
        }
      }

      // Extract filename from content-disposition header
      const contentDisposition = headers['content-disposition'] || '';
      const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
      let filename = filenameMatch ? decodeURIComponent(filenameMatch[1].trim()) : '';

      // Fallback: extract from the final resolved URL path
      if (!filename) {
        try {
          filename = path.basename(new URL(response.url()).pathname);
        } catch {
          filename = path.basename(fileUrl);
        }
      }

      // Final fallback: derive extension from mime type
      if (!filename || !filename.includes('.')) {
        if (mimeType.includes('pdf')) filename += '.pdf';
        else if (mimeType.includes('wordprocessingml')) filename += '.docx';
        else if (mimeType.includes('presentationml')) filename += '.pptx';
        else filename += '.bin';
      }

      return { buffer, mimeType, filename };
    } finally {
      await context.close();
    }
  }

  async getSectionText(url: string): Promise<SectionTextData> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });

      return await page.evaluate((sectionUrl) => {
        const title = document.querySelector('.sectionname, h2, h3')?.textContent?.trim() || 'Section Details';

        const extractLinks = (element: Element) => {
          return Array.from(element.querySelectorAll('a[href]')).map(a => ({
            name: a.textContent?.trim() || a.getAttribute('href') || 'Link',
            url: (a as HTMLAnchorElement).href
          })).filter(l => l.name.length > 0 && l.url && !l.url.startsWith('javascript:'));
        };

        // 1. Extract raw descriptions (text outside tabs)
        const summaryBox = document.querySelector('.summary, .course-description, .section-summary, .description');
        let mainText = '';
        let mainLinks: any[] = [];
        
        if (summaryBox) {
          const clone = summaryBox.cloneNode(true) as HTMLElement;
          const tabsContainers = clone.querySelectorAll('.nav-tabs, .tab-content, .tab-pane, [role="tablist"], [role="tabpanel"]');
          tabsContainers.forEach(n => n.remove());
          mainText = clone.textContent?.replace(/\n\s*\n/g, '\n').trim() || '';
          mainLinks = extractLinks(clone);
        }

        // 2. Extract hidden tab grids (.nav-tabs / .tab-content)
        const tabs: Array<{ title: string; content: string; links: Array<{ name: string; url: string }> }> = [];
        
        const navLinks = Array.from(document.querySelectorAll('.nav-tabs .nav-link, [role="tablist"] [role="tab"]'));
        const tabPanes = Array.from(document.querySelectorAll('.tab-content .tab-pane, [role="tabpanel"]'));

        if (navLinks.length > 0 && navLinks.length === tabPanes.length) {
          for (let i = 0; i < navLinks.length; i++) {
            const tabTitle = navLinks[i].textContent?.trim() || `Tab ${i + 1}`;
            const tabContent = tabPanes[i].textContent?.replace(/\n\s*\n/g, '\n').trim() || '';
            const tabLinks = extractLinks(tabPanes[i]);
            
            if (tabContent || tabLinks.length > 0) {
              tabs.push({ title: tabTitle, content: tabContent, links: tabLinks });
            }
          }
        } else if (tabPanes.length > 0) {
          tabPanes.forEach((pane, i) => {
             const tabContent = pane.textContent?.replace(/\n\s*\n/g, '\n').trim() || '';
             const tabLinks = extractLinks(pane);
             if (tabContent || tabLinks.length > 0) {
               tabs.push({ title: `Panel ${i + 1}`, content: tabContent, links: tabLinks });
             }
          });
        }
        
        return {
          url: sectionUrl,
          title,
          mainText,
          mainLinks,
          tabs
        };
      }, url);
    } finally {
      await page.close();
      await context.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const scraper = new EClassScraper();
