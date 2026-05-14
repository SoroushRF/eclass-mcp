import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Force absolute path for .env so Claude Desktop can find it
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

import { isSessionValid } from './scraper/session';
import { startAuthServer, openAuthWindow } from './auth/server';
import { listCourses } from './tools/courses';
import { getCourseContent, getSectionText } from './tools/content';
import { getFileText } from './tools/files';
import {
  getUpcomingDeadlines,
  getDeadlines,
  getItemDetails,
} from './tools/deadlines';
import { getGrades } from './tools/grades';
import { getAnnouncements } from './tools/announcements';
import { getExamSchedule, getClassTimetable } from './tools/sis';
import { searchProfessorsTool, getProfessorDetailsTool } from './tools/rmp';
import { clearCache } from './tools/cache';
import {
  cachePin,
  cacheUnpin,
  cacheListPins,
  cacheRefreshPin,
  cacheDeletePinned,
} from './tools/pins';
import {
  discoverCengageLinks,
  getCengageAssignmentDetails,
  getCengageAssignments,
  listCengageCourses,
} from './tools/cengage';
import {
  DiscoverCengageLinksInputSchema,
  GetCengageAssignmentDetailsInputSchema,
  GetCengageAssignmentsInputSchema,
  ListCengageCoursesInputSchema,
} from './tools/cengage-contracts';
import { rootLogger } from './logging/logger';
import { runWithToolContext } from './logging/context';

const bootstrapLog = rootLogger.child({ component: 'bootstrap' });

// Create the MCP server
const server = new McpServer({
  name: 'eclass-mcp',
  version: '1.0.0-beta.1',
});

// Register all tools with any casting to bypass literal-type inference issues
// and ensure we move forward with Task 8.
server.tool(
  'list_courses',
  'Lists all courses the student is enrolled in on eClass.',
  {},
  (async () =>
    await runWithToolContext('list_courses', () => listCourses())) as any
);

server.tool(
  'get_course_content',
  'Gets full content of a specific course.',
  { courseId: z.string().describe('The course ID') },
  (async ({ courseId }: any) =>
    await runWithToolContext('get_course_content', () =>
      getCourseContent(courseId)
    )) as any
);

server.tool(
  'get_section_text',
  'Fetches the literal paragraph text, embedded links, and hidden custom-layout tabs within a specific Moodle section. Provide the section URL.',
  { url: z.string().describe('The exact URL to the course section') },
  (async ({ url }: any) =>
    await runWithToolContext('get_section_text', () =>
      getSectionText(url)
    )) as any
);

server.tool(
  'get_file_text',
  'Extracts content from a course file (PDF, DOCX, PPTX). Returns text and/or images. ' +
    'For large PDFs, returns a partial result with an overview and instructions to fetch ' +
    'remaining pages using startPage/endPage parameters.',
  {
    courseId: z
      .string()
      .optional()
      .describe('The course ID (optional if unknown)'),
    fileUrl: z.string().describe('The file URL'),
    startPage: z
      .number()
      .optional()
      .describe('Start page for PDF extraction (1-indexed, default: 1)'),
    endPage: z
      .number()
      .optional()
      .describe(
        'End page for PDF extraction (1-indexed, default: startPage + 49)'
      ),
  },
  (async ({ courseId, fileUrl, startPage, endPage }: any) =>
    await runWithToolContext('get_file_text', () =>
      getFileText(courseId || 'unknown', fileUrl, startPage, endPage)
    )) as any
);

server.tool(
  'get_upcoming_deadlines',
  'Returns upcoming assignment deadlines.',
  {
    daysAhead: z.number().optional().describe('Days ahead (default 14)'),
    courseId: z.string().optional().describe('Filter by course ID'),
  },
  (async ({ daysAhead, courseId }: any) =>
    await runWithToolContext('get_upcoming_deadlines', () =>
      getUpcomingDeadlines(daysAhead, courseId)
    )) as any
);

server.tool(
  'get_deadlines',
  'Returns assignment/quiz deadlines for upcoming, month, or date range scopes.',
  {
    courseId: z.string().optional().describe('Filter by course ID'),
    scope: z
      .enum(['upcoming', 'month', 'range'])
      .optional()
      .describe('Scope (default upcoming)'),
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('Month (1-12) when scope=month'),
    year: z
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe('Year when scope=month'),
    from: z
      .string()
      .optional()
      .describe('Start date/time (ISO or YYYY-MM-DD) when scope=range'),
    to: z
      .string()
      .optional()
      .describe('End date/time (ISO or YYYY-MM-DD) when scope=range'),
    includeDetails: z
      .boolean()
      .optional()
      .describe('If true, fetch details for first maxDetails items'),
    maxDetails: z
      .number()
      .int()
      .min(0)
      .max(25)
      .optional()
      .describe('Max items to deep-fetch when includeDetails=true (default 7)'),
  },
  (async (args: any) =>
    await runWithToolContext('get_deadlines', () => getDeadlines(args))) as any
);

server.tool(
  'get_item_details',
  'Fetches assignment/quiz page details, optionally attaching vision instruction images (no OCR) with strict payload caps.',
  {
    url: z.string().describe('Assignment or quiz URL'),
    includeImages: z
      .boolean()
      .optional()
      .describe(
        'If true, attach instruction screenshots as vision image blocks (no OCR) when present'
      ),
    maxImages: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe('Max instruction images to attach (default 3)'),
    imageOffset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Pagination offset into instruction image list (default 0)'),
    maxTotalImageBytes: z
      .number()
      .int()
      .min(0)
      .max(1000000)
      .optional()
      .describe(
        'Max base64 payload budget for attached images (default 750000)'
      ),
    includeCsv: z
      .boolean()
      .optional()
      .describe(
        'If true, inline attached CSV files as text (no parsing heuristics) when present'
      ),
    csvMode: z
      .enum(['auto', 'full', 'preview'])
      .optional()
      .describe('CSV inlining mode (default auto)'),
    maxCsvBytes: z
      .number()
      .int()
      .min(0)
      .max(2000000)
      .optional()
      .describe('Max CSV bytes to inline (default 200000)'),
    csvPreviewLines: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe(
        'When previewing/truncating, max number of lines to include (default 200)'
      ),
    maxCsvAttachments: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe('Max number of CSV attachments to inline (default 3)'),
  },
  (async (args: any) =>
    await runWithToolContext('get_item_details', () =>
      getItemDetails(args)
    )) as any
);

server.tool(
  'get_grades',
  "Returns the student's grades.",
  { courseId: z.string().optional().describe('Filter by course ID') },
  (async ({ courseId }: any) =>
    await runWithToolContext('get_grades', () => getGrades(courseId))) as any
);

server.tool(
  'get_announcements',
  'Returns recent course announcements.',
  {
    courseId: z.string().optional().describe('Filter by course ID'),
    limit: z.number().optional().describe('Max number (default 10)'),
  },
  (async ({ courseId, limit }: any) =>
    await runWithToolContext('get_announcements', () =>
      getAnnouncements(courseId, limit)
    )) as any
);

server.tool(
  'get_exam_schedule',
  "Fetches the current student's personal exam schedule from York SIS.",
  {},
  (async () =>
    await runWithToolContext('get_exam_schedule', () =>
      getExamSchedule()
    )) as any
);

server.tool(
  'get_class_timetable',
  "Fetches the current student's personal class timetable from York SIS for the current session.",
  {},
  (async () =>
    await runWithToolContext('get_class_timetable', () =>
      getClassTimetable()
    )) as any
);

server.tool(
  'search_professors',
  'Finds professor profiles on RateMyProfessors for York University campuses.',
  {
    name: z.string().describe('The name of the professor'),
    campus: z
      .enum(['Keele', 'Glendon', 'Markham'])
      .optional()
      .describe('Optional York campus filter'),
  },
  (async (args: any) =>
    await runWithToolContext('search_professors', () =>
      searchProfessorsTool(args)
    )) as any
);

server.tool(
  'get_professor_details',
  'Fetches detailed ratings, difficulty, and student comments for a specific professor from RateMyProfessors.',
  {
    teacherId: z
      .string()
      .describe('The RMP teacher ID (from search_professors)'),
  },
  (async (args: any) =>
    await runWithToolContext('get_professor_details', () =>
      getProfessorDetailsTool(args)
    )) as any
);

server.tool(
  'discover_cengage_links',
  'Scans raw text for Cengage/WebAssign URLs and returns normalized, classified link candidates with source hints.',
  DiscoverCengageLinksInputSchema.shape,
  (async ({ text, source, courseId, sectionUrl, sourceFile }: any) =>
    await runWithToolContext('discover_cengage_links', () =>
      discoverCengageLinks({
        text,
        source,
        courseId,
        sectionUrl,
        sourceFile,
      })
    )) as any
);

server.tool(
  'list_cengage_courses',
  'Lists available Cengage/WebAssign courses from saved session state (dashboard-first) or from a provided entry URL/discovered link, with optional query pre-filtering.',
  ListCengageCoursesInputSchema.shape,
  (async ({ entryUrl, discoveredLink, courseQuery }: any) =>
    await runWithToolContext('list_cengage_courses', () =>
      listCengageCourses({ entryUrl, discoveredLink, courseQuery })
    )) as any
);

server.tool(
  'get_cengage_assignments',
  'Fetches assignment list and deadlines from Cengage/WebAssign using dashboard-first saved-session flow or explicit direct course/dashboard/legacy SSO links. Supports optional course selection inputs when multiple courses are present.',
  GetCengageAssignmentsInputSchema.shape,
  (async ({ entryUrl, ssoUrl, courseId, courseKey, courseQuery }: any) =>
    await runWithToolContext('get_cengage_assignments', () =>
      getCengageAssignments({
        entryUrl,
        ssoUrl,
        courseId,
        courseKey,
        courseQuery,
      })
    )) as any
);

server.tool(
  'get_cengage_assignment_details',
  'Opens a specific Cengage/WebAssign assignment and extracts question-level prompts, scoring hints, answers, and resource links (similar to deep item details on eClass).',
  GetCengageAssignmentDetailsInputSchema.shape,
  (async ({
    entryUrl,
    ssoUrl,
    courseId,
    courseKey,
    courseQuery,
    assignmentUrl,
    assignmentId,
    assignmentQuery,
    includeAnswers,
    includeResources,
    maxQuestions,
    maxQuestionTextChars,
    maxAnswerTextChars,
  }: any) =>
    await runWithToolContext('get_cengage_assignment_details', () =>
      getCengageAssignmentDetails({
        entryUrl,
        ssoUrl,
        courseId,
        courseKey,
        courseQuery,
        assignmentUrl,
        assignmentId,
        assignmentQuery,
        includeAnswers,
        includeResources,
        maxQuestions,
        maxQuestionTextChars,
        maxAnswerTextChars,
      })
    )) as any
);

server.tool(
  'clear_cache',
  'Clears default (TTL) cache for the given scope. User-pinned entries are never removed; use cache_delete_pinned to remove pinned data. Response states that pins are unchanged.',
  {
    scope: z
      .enum([
        'all',
        'volatile',
        'deadlines',
        'announcements',
        'grades',
        'content',
        'courses',
        'files',
        'rmp',
      ])
      .optional()
      .default('all')
      .describe('The scope of cache to clear (default: all)'),
  },
  (async ({ scope }: any) =>
    await runWithToolContext('clear_cache', () => clearCache(scope))) as any
);

const pinResourceEnum = z.enum(['file', 'sectiontext', 'content']);

server.tool(
  'cache_pin',
  'Pin a cached resource (file, section text, or course content) so it is kept past TTL until unpinned. Requires the resource to already exist in cache. Subject to ECLASS_MCP_PIN_QUOTA_BYTES. For file: fileUrl (+ optional startPage/endPage). For sectiontext: url. For content: courseId.',
  {
    resource_type: pinResourceEnum,
    fileUrl: z.string().optional().describe('Required when resource_type=file'),
    startPage: z.number().optional(),
    endPage: z.number().optional(),
    url: z
      .string()
      .optional()
      .describe('Required when resource_type=sectiontext'),
    courseId: z
      .string()
      .optional()
      .describe('Required when resource_type=content'),
    note: z.string().optional(),
  },
  (async (args: any) =>
    await runWithToolContext('cache_pin', () => cachePin(args))) as any
);

server.tool(
  'cache_unpin',
  'Remove a pin from the registry without deleting the cache file. Use cache_delete_pinned to remove stored bytes.',
  { pinId: z.string().describe('Pin ID from cache_list_pins') },
  (async ({ pinId }: any) =>
    await runWithToolContext('cache_unpin', () => cacheUnpin({ pinId }))) as any
);

server.tool(
  'cache_list_pins',
  'List pinned resources and quota usage (used_bytes vs limit_bytes).',
  {
    resource_type: pinResourceEnum.optional().describe('Filter by type'),
  },
  (async ({ resource_type }: any) =>
    await runWithToolContext('cache_list_pins', () =>
      cacheListPins({ resource_type })
    )) as any
);

server.tool(
  'cache_refresh_pin',
  'Re-fetch and refresh the underlying cached data for a pin (resets TTL for that cache entry).',
  { pinId: z.string() },
  (async ({ pinId }: any) =>
    await runWithToolContext('cache_refresh_pin', () =>
      cacheRefreshPin({ pinId })
    )) as any
);

server.tool(
  'cache_delete_pinned',
  'Explicitly delete pinned cache files and remove pin records. Pass pinId for one item, or mode=all to clear all pins, or mode=by_type with resource_type.',
  {
    pinId: z.string().optional(),
    mode: z.enum(['all', 'by_type']).optional(),
    resource_type: pinResourceEnum.optional(),
  },
  (async (args: any) =>
    await runWithToolContext('cache_delete_pinned', () =>
      cacheDeletePinned(args)
    )) as any
);

// Main startup
async function main() {
  // Always start auth server in background so it's ready for redirects
  await startAuthServer();

  if (!isSessionValid()) {
    bootstrapLog.warn(
      'eClass session not found or stale. Opening login window...'
    );
    openAuthWindow();
  } else {
    bootstrapLog.info('eClass session check: Local session file found.');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  rootLogger.fatal({ err: error }, 'Fatal error in MCP server');
  process.exit(1);
});
