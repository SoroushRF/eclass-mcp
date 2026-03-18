import { chromium, BrowserContext, Cookie } from 'playwright';
import { loadSession } from './session.js';
import dotenv from 'dotenv';

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
  private async getAuthenticatedContext(): Promise<{ browser: any; context: BrowserContext }> {
    const cookies = loadSession();
    if (!cookies) {
      throw new SessionExpiredError();
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(cookies as any); // Cast as PW's Cookie matches closely enough

    return { browser, context };
  }

  private async checkAuth(page: any): Promise<void> {
    const currentUrl = page.url();
    // If redirected to login page, session is likely invalid
    if (currentUrl.includes('/login/') || currentUrl.includes('passport.yorku.ca')) {
      throw new SessionExpiredError();
    }
  }

  async getCourses(): Promise<Course[]> {
    const { browser, context } = await this.getAuthenticatedContext();
    try {
      const page = await context.newPage();
      await page.goto(ECLASS_URL);
      await this.checkAuth(page);

      // Placeholder for Task 10
      return [];
    } finally {
      await browser.close();
    }
  }

  async getCourseContent(courseId: string): Promise<CourseContent> {
    const { browser, context } = await this.getAuthenticatedContext();
    try {
      const page = await context.newPage();
      await page.goto(`${ECLASS_URL}/course/view.php?id=${courseId}`);
      await this.checkAuth(page);

      // Placeholder for Task 10
      return {
        sections: [],
        files: [],
        assignments: [],
        announcements: [],
      };
    } finally {
      await browser.close();
    }
  }

  async getDeadlines(courseId?: string): Promise<Assignment[]> {
    const { browser, context } = await this.getAuthenticatedContext();
    try {
      const page = await context.newPage();
      await page.goto(`${ECLASS_URL}/calendar/view.php?view=upcoming`);
      await this.checkAuth(page);

      // Placeholder for Task 10
      return [];
    } finally {
      await browser.close();
    }
  }

  async getGrades(courseId?: string): Promise<Grade[]> {
    const { browser, context } = await this.getAuthenticatedContext();
    try {
      const page = await context.newPage();
      if (courseId) {
        await page.goto(`${ECLASS_URL}/grade/report/user/index.php?id=${courseId}`);
      } else {
        await page.goto(`${ECLASS_URL}/grade/report/overview/index.php`);
      }
      await this.checkAuth(page);

      // Placeholder for Task 10
      return [];
    } finally {
      await browser.close();
    }
  }

  async getAnnouncements(courseId?: string, limit: number = 10): Promise<Announcement[]> {
    const { browser, context } = await this.getAuthenticatedContext();
    try {
      const page = await context.newPage();
      // Logic would typically involve going to a course page or overall feed
      // Placeholder for Task 10
      return [];
    } finally {
      await browser.close();
    }
  }

  async downloadFile(fileUrl: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const { browser, context } = await this.getAuthenticatedContext();
    try {
      const page = await context.newPage();
      
      const [response] = await Promise.all([
        page.waitForResponse(res => res.url() === fileUrl && res.status() === 200),
        page.goto(fileUrl),
      ]);

      await this.checkAuth(page);

      const buffer = await response.body();
      const contentDisposition = response.headers()['content-disposition'];
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || 'downloaded_file';
      const mimeType = response.headers()['content-type'] || 'application/octet-stream';

      return { buffer, mimeType, filename };
    } finally {
      await browser.close();
    }
  }
}

export const scraper = new EClassScraper();
