import { loadSession, SessionExpiredError } from './session';
import { chromium, Page } from 'playwright';

export { SessionExpiredError };

export interface SISExam {
  courseCode: string;
  section: string;
  courseTitle: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  campus: string;
  rooms: string;
}

export interface SISTimetableEntry {
  courseCode: string;
  term: string;
  section: string;
  type: string;
  days: string;
  startTime: string;
  durationMinutes: number;
  room: string;
}

/**
 * Scraper for York SIS (Student Information System)
 */
export class SISScraper {
  private static EXAM_URL = 'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/cde';
  private static TIMETABLE_URL = 'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/cds';

  private async getAuthenticatedPage(): Promise<{ page: Page; close: () => Promise<void> }> {
    const cookies = loadSession();
    if (!cookies) {
      throw new SessionExpiredError();
    }

    const browser = await chromium.launch({ 
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
      ],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await context.addCookies(cookies);
    const page = await context.newPage();

    return { 
      page, 
      close: async () => {
        await browser.close();
      }
    };
  }

  private async handleSessionSelection(page: Page) {
    const hasSessions = await page.evaluate(() => 
      document.body.innerText.includes('select the academic session')
    );
    
    if (hasSessions) {
      const sessionLink = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        // Prefer current year Undergraduate session
        const now = new Date();
        const year = now.getFullYear();
        const prevYear = year - 1;
        const label = `${prevYear}-${year}`; 
        const target = links.find(a => 
          a.textContent?.includes('UNDERGRADUATE') && 
          (a.textContent?.includes(label) || a.textContent?.includes(year.toString()))
        );
        return target ? target.href : null;
      });

      if (sessionLink) {
        await page.goto(sessionLink, { waitUntil: 'load' });
      }
    }
  }

  /**
   * Scrape the Exam Schedule
   */
  async scrapeExams(): Promise<SISExam[]> {
    const { page, close } = await this.getAuthenticatedPage();
    try {
      await page.goto(SISScraper.EXAM_URL, { waitUntil: 'load', timeout: 30000 });
      
      await this.handleSessionSelection(page);

      const exams = await page.evaluate(() => {
        // Find the table that contains "Course" and "Date" in its headers
        const tables = Array.from(document.querySelectorAll('table'));
        const examTable = tables.find(t => {
          const text = t.innerText.toLowerCase();
          return text.includes('course') && text.includes('date') && text.includes('start time');
        });

        if (!examTable) return [];

        const rows = Array.from(examTable.querySelectorAll('tr')).slice(1);
        return rows.map(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
          if (cells.length < 8) return null;
          return {
            courseCode: cells[0].replace(/\n/g, ' / '),
            section: cells[1],
            courseTitle: cells[2],
            date: cells[3],
            startTime: cells[4],
            durationMinutes: parseInt(cells[5]) || 0,
            campus: cells[6],
            rooms: cells[7]
          };
        }).filter(x => x !== null) as SISExam[];
      });

      return exams;
    } finally {
      await close();
    }
  }

  /**
   * Scrape the Timetable (List view)
   */
  async scrapeTimetable(): Promise<SISTimetableEntry[]> {
    const { page, close } = await this.getAuthenticatedPage();
    try {
      await page.goto(SISScraper.TIMETABLE_URL, { waitUntil: 'load', timeout: 30000 });
      
      await this.handleSessionSelection(page);

      const entries = await page.evaluate(() => {
        // SIS uses border="2" for the timetable list tables
        const tables = Array.from(document.querySelectorAll('table[border="2"]'));
        const allEntries: any[] = [];

        tables.forEach(table => {
          const rows = Array.from(table.querySelectorAll('tr')).slice(1);
          rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
            if (cells.length < 8) return;
            allEntries.push({
              courseCode: cells[0].replace(/\n/g, ' ').replace(/\s+/g, ' '),
              term: cells[1],
              section: cells[2],
              type: cells[3],
              days: cells[4],
              startTime: cells[5],
              durationMinutes: parseInt(cells[6]) || 0,
              room: cells[7]
            });
          });
        });

        return allEntries as SISTimetableEntry[];
      });

      return entries;
    } finally {
      await close();
    }
  }
}
