import { getAuthUrl } from '../auth/server';
import {
  SisExamScheduleResponseSchema,
  SisTimetableResponseSchema,
} from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { runEclassToolBoundary } from './tool-boundary';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

const INTERNAL_ERROR_MESSAGE =
  'The tool failed due to an unexpected internal error.';

export async function getExamSchedule(
  deps: ToolDependencies = createDefaultToolDependencies()
) {
  const scraper = deps.createSisScraper();
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

  return runEclassToolBoundary({
    toolName: 'get_exam_schedule',
    run,
    onSessionExpired: {
      retry: run,
      fallback: () =>
        asValidatedMcpText('get_exam_schedule', SisExamScheduleResponseSchema, {
          status: 'auth_required',
          code: 'SESSION_EXPIRED',
          message:
            'Your York session has expired. A login window has been opened. Please log in and try again.',
          retry: {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          },
        }),
    },
    onUnknownError: () =>
      asValidatedMcpText('get_exam_schedule', SisExamScheduleResponseSchema, {
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: INTERNAL_ERROR_MESSAGE,
      }),
  });
}

export async function getClassTimetable(
  deps: ToolDependencies = createDefaultToolDependencies()
) {
  const scraper = deps.createSisScraper();
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

  return runEclassToolBoundary({
    toolName: 'get_class_timetable',
    run,
    onSessionExpired: {
      retry: run,
      fallback: () =>
        asValidatedMcpText('get_class_timetable', SisTimetableResponseSchema, {
          status: 'auth_required',
          code: 'SESSION_EXPIRED',
          message:
            'Your York session has expired. A login window has been opened. Please log in and try again.',
          retry: {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          },
        }),
    },
    onUnknownError: () =>
      asValidatedMcpText('get_class_timetable', SisTimetableResponseSchema, {
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: INTERNAL_ERROR_MESSAGE,
      }),
  });
}
