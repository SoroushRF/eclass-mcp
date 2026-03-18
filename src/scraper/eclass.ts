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
    super('eClass session expired or invalid. Please re-authenticate at http://localhost:3000/auth');
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

        // --- Phase 2: Full Playwright page (handles JS-rendered viewer pages) ---
        // Moodle's /mod/resource/view.php renders the file viewer via JavaScript,
        // so the static HTML from a plain HTTP request is a skeleton with no file URL.
        // We spin up a real browser page to either catch the download event or
        // read the live DOM after JS has executed.
        if (!directUrl) {
          const page = await context.newPage();
          try {
            // Arm download listener BEFORE navigating so we don't miss it
            const downloadPromise = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);

            await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // Give JS a moment to inject the viewer (iframe / object / redirect)
            await page.waitForTimeout(2000);

            const download = await downloadPromise;
            if (download) {
              // Browser triggered a file download — stream it directly into a buffer
              const stream = await download.createReadStream();
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', resolve);
                stream.on('error', reject);
              });
              const filename = download.suggestedFilename();
              const fileBuffer = Buffer.concat(chunks);
              // Resolve mime type from filename since download events don't carry content-type
              let resolvedMime = 'application/octet-stream';
              const ext = path.extname(filename).toLowerCase();
              if (ext === '.pdf') resolvedMime = 'application/pdf';
              else if (ext === '.docx') resolvedMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              else if (ext === '.pptx') resolvedMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
              return { buffer: fileBuffer, mimeType: resolvedMime, filename };
            }

            // No download event — inspect the live rendered DOM for the file URL
            directUrl = await page.evaluate(() => {
              // Moodle object viewer
              const obj = document.querySelector<HTMLObjectElement>('object[data]');
              if (obj?.data) return obj.data;

              // Moodle iframe viewer
              const iframe = document.querySelector<HTMLIFrameElement>('iframe[src]');
              if (iframe?.src) return iframe.src;

              // Resourceworkaround or forcedownload links
              const workaround = document.querySelector<HTMLAnchorElement>(
                '.resourceworkaround a, a[href*="forcedownload=1"]'
              );
              if (workaround?.href) return workaround.href;

              // Any pluginfile.php link (direct Moodle file storage URL)
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

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const scraper = new EClassScraper();
