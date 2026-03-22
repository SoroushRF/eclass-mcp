import { SISScraper, SessionExpiredError } from '../scraper/sis';
import { openAuthWindow } from '../auth/server';

const scraper = new SISScraper();

export async function getExamSchedule() {
  try {
    const exams = await scraper.scrapeExams();
    if (exams.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No upcoming exams found in your York SIS schedule.' }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: `Found ${exams.length} upcoming exams:\n\n${JSON.stringify(exams, null, 2)}`
      }]
    };
  } catch (error: any) {
    if (error instanceof SessionExpiredError) {
      openAuthWindow();
      return {
        content: [{ 
          type: 'text' as const, 
          text: 'Your York session has expired. A login window has been opened. Please log in and try again.' 
        }]
      };
    }
    return {
      content: [{ type: 'text' as const, text: `Error fetching exam schedule: ${error.message}` }],
      isError: true
    };
  }
}

export async function getClassTimetable() {
  try {
    const entries = await scraper.scrapeTimetable();
    if (entries.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No classes found in your York SIS timetable for the current session.' }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: `Found ${entries.length} timetable entries:\n\n${JSON.stringify(entries, null, 2)}`
      }]
    };
  } catch (error: any) {
    if (error instanceof SessionExpiredError) {
      openAuthWindow();
      return {
        content: [{ 
          type: 'text' as const, 
          text: 'Your York session has expired. A login window has been opened. Please log in and try again.' 
        }]
      };
    }
    return {
      content: [{ type: 'text' as const, text: `Error fetching class timetable: ${error.message}` }],
      isError: true
    };
  }
}
