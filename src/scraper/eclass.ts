import { chromium, Browser, BrowserContext } from 'playwright';
import { loadSession } from './session.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const ECLASS_URL = process.env.ECLASS_URL || 'https://eclass.yorku.ca';

export class SessionExpiredError extends Error {
  constructor() {
    super('eClass session expired. Please re-authenticate at http://localhost:3000/auth');
    this.name = 'SessionExpiredError';
  }
}

export interface Course {
  id: string;
  name: string;
  code: string;
  url: string;
}

export interface Section {
  name: string;
  content: string;
}

export interface FileItem {
  id: string;
  name: string;
  url: string;
  type: string;
}

export interface Assignment {
  id: string;
  title: string;
  courseId: string;
  courseName: string;
  dueDate: Date;
  submitted: boolean;
}

export interface Grade {
  item: string;
  courseId: string;
  grade: string;
  max: string;
  feedback: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  author: string;
  date: Date;
  courseId: string;
}

export interface CourseContent {
  sections: Section[];
  files: FileItem[];
  assignments: Assignment[];
  announcements: Announcement[];
}

export class EClassScraper {
  private browser: Browser | null = null;
  private currentContext: BrowserContext | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  private async getAuthenticatedContext(): Promise<BrowserContext> {
    const cookies = loadSession();
    if (!cookies) {
      throw new SessionExpiredError();
    }

    const browser = await this.getBrowser();
    
    // Check if current context is valid. If not, create one.
    if (!this.currentContext) {
      this.currentContext = await browser.newContext();
      await this.currentContext.addCookies(cookies as any);
    }
    
    return this.currentContext;
  }

  private async checkAuth(page: any): Promise<void> {
    const currentUrl = page.url();
    // Use common patterns for York passport and eClass login redirect
    if (currentUrl.includes('/login/') || currentUrl.includes('passport.yorku.ca')) {
      // Invalidate context if auth fails
      this.currentContext = null;
      throw new SessionExpiredError();
    }
  }

  /**
   * Closes the active browser and clears the context.
   * Useful during shutdown or for force-restarting.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.currentContext = null;
    }
  }

  async getCourses(): Promise<Course[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(ECLASS_URL);
      await this.checkAuth(page);
      return []; // Placeholder for Task 10
    } finally {
      await page.close();
    }
  }

  async getCourseContent(courseId: string): Promise<CourseContent> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(`${ECLASS_URL}/course/view.php?id=${courseId}`);
      await this.checkAuth(page);
      return { sections: [], files: [], assignments: [], announcements: [] };
    } finally {
      await page.close();
    }
  }

  async getDeadlines(courseId?: string): Promise<Assignment[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      await page.goto(`${ECLASS_URL}/calendar/view.php?view=upcoming`);
      await this.checkAuth(page);
      return [];
    } finally {
      await page.close();
    }
  }

  async getGrades(courseId?: string): Promise<Grade[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      if (courseId) {
        await page.goto(`${ECLASS_URL}/grade/report/user/index.php?id=${courseId}`);
      } else {
        await page.goto(`${ECLASS_URL}/grade/report/overview/index.php`);
      }
      await this.checkAuth(page);
      return [];
    } finally {
      await page.close();
    }
  }

  async getAnnouncements(courseId?: string, limit: number = 10): Promise<Announcement[]> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
        // eClass announcements are typically at /mod/forum/view.php?id=... 
        // We'll at least go to the dashboard as a starting point if no ID is given
        await page.goto(`${ECLASS_URL}/my/`);
        await this.checkAuth(page);
        return [];
    } finally {
        await page.close();
    }
  }

  async downloadFile(fileUrl: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const context = await this.getAuthenticatedContext();
    const page = await context.newPage();
    try {
      // Handle navigation and download trigger
      const [response] = await Promise.all([
        page.waitForResponse(res => res.url() === fileUrl && res.status() === 200, { timeout: 30000 }),
        page.goto(fileUrl),
      ]);

      await this.checkAuth(page);

      const buffer = await response.body();
      const headers = response.headers();
      const contentDisposition = headers['content-disposition'];
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'downloaded_file';
      const mimeType = headers['content-type'] || 'application/octet-stream';

      return { buffer, mimeType, filename };
    } finally {
      await page.close();
    }
  }
}

export const scraper = new EClassScraper();
