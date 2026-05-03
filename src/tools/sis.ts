import { SISScraper, SessionExpiredError } from '../scraper/sis';
import { getAuthUrl } from '../auth/server';
import {
  SisExamScheduleResponseSchema,
  SisTimetableResponseSchema,
} from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { handleEclassSessionExpired } from './auth-retry';

const scraper = new SISScraper();

export async function getExamSchedule() {
  const run = async () => {
    const exams = await scraper.scrapeExams();
    if (exams.length === 0) {
      return asValidatedMcpText(
        'get_exam_schedule',
        SisExamScheduleResponseSchema,
        {
          status: 'empty',
          message: 'No upcoming exams found in your York SIS schedule.',
          exams: [],
        }
      );
    }

    return asValidatedMcpText(
      'get_exam_schedule',
      SisExamScheduleResponseSchema,
      {
        status: 'ok',
        message: `Found ${exams.length} upcoming exam(s). See "exams" for structured data.`,
        exams,
      }
    );
  };

  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof SessionExpiredError) {
      return handleEclassSessionExpired(error, run, () =>
        asValidatedMcpText('get_exam_schedule', SisExamScheduleResponseSchema, {
          status: 'auth_required',
          code: 'SESSION_EXPIRED',
          message:
            'Your York session has expired. A login window has been opened. Please log in and try again.',
          retry: {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          },
        })
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return asValidatedMcpText(
      'get_exam_schedule',
      SisExamScheduleResponseSchema,
      {
        status: 'error',
        message: `Error fetching exam schedule: ${message}`,
      }
    );
  }
}

export async function getClassTimetable() {
  const run = async () => {
    const entries = await scraper.scrapeTimetable();
    if (entries.length === 0) {
      return asValidatedMcpText(
        'get_class_timetable',
        SisTimetableResponseSchema,
        {
          status: 'empty',
          message:
            'No classes found in your York SIS timetable for the current session.',
          entries: [],
        }
      );
    }

    return asValidatedMcpText(
      'get_class_timetable',
      SisTimetableResponseSchema,
      {
        status: 'ok',
        message: `Found ${entries.length} timetable entr(y/ies). See "entries" for structured data.`,
        entries,
      }
    );
  };

  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof SessionExpiredError) {
      return handleEclassSessionExpired(error, run, () =>
        asValidatedMcpText('get_class_timetable', SisTimetableResponseSchema, {
          status: 'auth_required',
          code: 'SESSION_EXPIRED',
          message:
            'Your York session has expired. A login window has been opened. Please log in and try again.',
          retry: {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          },
        })
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return asValidatedMcpText(
      'get_class_timetable',
      SisTimetableResponseSchema,
      {
        status: 'error',
        message: `Error fetching class timetable: ${message}`,
      }
    );
  }
}
