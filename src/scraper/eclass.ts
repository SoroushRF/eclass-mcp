import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { loadSession } from './session';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';


dotenv.config({ quiet: true });

const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';

export interface Course {
  id: string;
  name: string;
  url: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  author: string;
}

export interface Assignment {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  courseId: string;
  url: string;
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
    super('eClass session expired or invalid. Please re-authenticate.');
    this.name = 'SessionExpiredError';
  }
}

class EClassScraper {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  private async getAuthenticatedContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const cookies = loadSession();
    if (!cookies || cookies.length === 0) {
      throw new SessionExpiredError();
    }
    const context = await browser.newContext();
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
      await page.goto(`${ECLASS_URL}/my/`, { waitUntil: 'networkidle' });
      
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
            url: url
          };
        }).filter(c => c.id);
      });

      if (courses.length === 0) await this.dumpPage(page, 'dashboard_empty');
      return courses;
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
      
      // Selectors for sections and their modules
      const sections = await page.evaluate((cid) => {
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
      }, courseId);

      return { courseId, sections: sections as any };
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
          const titleLink = ev.querySelector('.name a') as HTMLAnchorElement;
          const dateStr = ev.querySelector('.date')?.textContent?.trim() || '';
          const courseLink = ev.querySelector('.course a') as HTMLAnchorElement;
          
          return {
            id: titleLink?.href.match(/id=(\d+)/)?.[1] || Math.random().toString(),
            name: titleLink?.textContent?.trim() || 'Untitled Event',
            dueDate: dateStr,
            status: 'Upcoming',
            courseId: courseLink?.href.match(/id=(\d+)/)?.[1] || '',
            url: titleLink?.href || ''
          };
        }).filter(d => d.url.includes('assign'));
      });

      return deadlines as Assignment[];
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
      // Typically the 'News Forum' or 'Announcements' link on course page
      // We'll navigate to the forum listing directly if we have a courseId
      if (courseId) {
        await page.goto(`${ECLASS_URL}/mod/forum/view.php?id=${courseId}`, { waitUntil: 'networkidle' });
      } else {
        await page.goto(`${ECLASS_URL}/my/`, { waitUntil: 'networkidle' });
      }

      const announcements = await page.evaluate(() => {
        const topics = Array.from(document.querySelectorAll('.topic, .discussion'));
        return topics.map(t => {
          const link = t.querySelector('.subject a, .topic-name a') as HTMLAnchorElement;
          return {
            id: link?.href.match(/d=(\d+)/)?.[1] || '',
            title: link?.textContent?.trim() || 'Untitled',
            content: '', // Full content usually requires extra navigation
            date: t.querySelector('.lastpost date, .modified')?.textContent?.trim() || '',
            author: t.querySelector('.author')?.textContent?.trim() || ''
          };
        }).filter(a => a.id);
      });

      return announcements.slice(0, limit) as Announcement[];
    } finally {
      await page.close();
      await context.close();
    }
  }

  async downloadFile(fileUrl: string): Promise<{ buffer: Buffer, mimeType: string, filename: string }> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      const [response] = await Promise.all([
        page.waitForResponse(res => res.url().includes(fileUrl) || res.status() === 200, { timeout: 30000 }),
        page.goto(fileUrl)
      ]);
      
      const buffer = await response.body();
      const headers = response.headers();
      const mimeType = headers['content-type'] || 'application/octet-stream';
      
      // Try to get filename from content-disposition header
      const contentDisposition = headers['content-disposition'] || '';
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : path.basename(fileUrl);

      return { buffer, mimeType, filename };
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
