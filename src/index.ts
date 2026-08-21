import {
  McpServer,
  type ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolResultSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Force absolute path for .env so Claude Desktop can find it
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

import { isSessionValid } from './scraper/session';
import { scraper as eclassScraper } from './scraper/eclass';
import { startAuthServer, openAuthWindow, stopAuthServer } from './auth/server';
import { listCourses } from './tools/courses';
import { getCourseContent, getSectionText } from './tools/content';
import { getFileText } from './tools/files';
import {
  getUpcomingDeadlines,
  getDeadlines,
  getItemDetails,
} from './tools/deadlines';
import { getAssignments } from './tools/assignments';
import { prepareAssignmentSubmission } from './tools/assignment-preflight';
import { getGrades } from './tools/grades';
import { getAnnouncements } from './tools/announcements';
import { getExamSchedule, getClassTimetable } from './tools/sis';
import { searchProfessorsTool, getProfessorDetailsTool } from './tools/rmp';
import { cacheHealth, clearCache } from './tools/cache';
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
import { GetAssignmentsInputSchema } from './tools/assignment-contracts';
import { AssignmentSubmissionPreflightInputSchema } from './tools/write-contracts';
import { rootLogger } from './logging/logger';
import { runWithToolContext } from './logging/context';
import {
  SecureSessionStorageError,
  isSecureSessionConfigured,
} from './security/secure-session-store';
import {
  createDefaultToolDependencies,
  closeDefaultEclassHybridProvider,
  type ToolDependencies,
} from './tools/dependencies';
import { createShutdownController } from './runtime/shutdown';
import { closeActiveCengageScrapers } from './scraper/cengage';
import { closeActiveSisBrowsers } from './scraper/sis';

const bootstrapLog = rootLogger.child({ component: 'bootstrap' });
const shutdownLog = rootLogger.child({ component: 'shutdown' });

function asCallToolResult(result: unknown): CallToolResult {
  return CallToolResultSchema.parse(result);
}

function createInputToolCallback<const InputSchema extends ZodRawShapeCompat>(
  name: string,
  handler: (args: ShapeOutput<InputSchema>) => unknown | Promise<unknown>
): ToolCallback<InputSchema> {
  const callback = async (
    args: ShapeOutput<InputSchema>
  ): Promise<CallToolResult> => {
    const result = await runWithToolContext(name, async () => handler(args));
    return asCallToolResult(result);
  };

  // The SDK's registerTool generic order makes InputSchema inference ambiguous
  // when no outputSchema is supplied. Keep the compatibility cast isolated here.
  return callback as unknown as ToolCallback<InputSchema>;
}

function registerNoInputTool(
  server: McpServer,
  name: string,
  description: string,
  handler: () => unknown | Promise<unknown>
): void {
  server.registerTool(name, { description }, async () => {
    const result = await runWithToolContext(name, async () => handler());
    return asCallToolResult(result);
  });
}

function registerInputTool<const InputSchema extends ZodRawShapeCompat>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: InputSchema,
  handler: (args: ShapeOutput<InputSchema>) => unknown | Promise<unknown>
): void {
  server.registerTool<ZodRawShapeCompat, InputSchema>(
    name,
    { description, inputSchema },
    createInputToolCallback(name, handler)
  );
}

const courseIdInputSchema = {
  courseId: z.string().describe('The course ID'),
} satisfies ZodRawShapeCompat;

const sectionTextInputSchema = {
  url: z.string().describe('The exact URL to the course section'),
} satisfies ZodRawShapeCompat;

const getFileTextInputSchema = {
  courseId: z
    .string()
    .optional()
    .describe('The course ID (optional if unknown)'),
  fileUrl: z.string().describe('The file URL'),
  startPage: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Start page for PDF extraction (1-indexed, default: 1)'),
  endPage: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'End page for PDF extraction (1-indexed, default: startPage + 49)'
    ),
} satisfies ZodRawShapeCompat;

const getAssignmentsInputSchema =
  GetAssignmentsInputSchema.shape satisfies ZodRawShapeCompat;

const prepareAssignmentSubmissionInputSchema =
  AssignmentSubmissionPreflightInputSchema.shape satisfies ZodRawShapeCompat;

const getUpcomingDeadlinesInputSchema = {
  daysAhead: z.number().optional().describe('Days ahead (default 14)'),
  courseId: z.string().optional().describe('Filter by course ID'),
} satisfies ZodRawShapeCompat;

const getDeadlinesInputSchema = {
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
} satisfies ZodRawShapeCompat;

const getItemDetailsInputSchema = {
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
    .describe('Max base64 payload budget for attached images (default 750000)'),
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
} satisfies ZodRawShapeCompat;

const optionalCourseIdInputSchema = {
  courseId: z.string().optional().describe('Filter by course ID'),
} satisfies ZodRawShapeCompat;

const getAnnouncementsInputSchema = {
  courseId: z.string().optional().describe('Filter by course ID'),
  limit: z.number().optional().describe('Max number (default 10)'),
} satisfies ZodRawShapeCompat;

const searchProfessorsInputSchema = {
  name: z.string().describe('The name of the professor'),
  campus: z
    .enum(['Keele', 'Glendon', 'Markham'])
    .optional()
    .describe('Optional York campus filter'),
} satisfies ZodRawShapeCompat;

const getProfessorDetailsInputSchema = {
  teacherId: z.string().describe('The RMP teacher ID (from search_professors)'),
} satisfies ZodRawShapeCompat;

const discoverCengageLinksInputSchema =
  DiscoverCengageLinksInputSchema.shape satisfies ZodRawShapeCompat;

const listCengageCoursesInputSchema =
  ListCengageCoursesInputSchema.shape satisfies ZodRawShapeCompat;

const getCengageAssignmentsInputSchema =
  GetCengageAssignmentsInputSchema.shape satisfies ZodRawShapeCompat;

const getCengageAssignmentDetailsInputSchema =
  GetCengageAssignmentDetailsInputSchema.shape satisfies ZodRawShapeCompat;

const clearCacheInputSchema = {
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
} satisfies ZodRawShapeCompat;

const pinResourceEnum = z.enum(['file', 'sectiontext', 'content']);

const cachePinInputSchema = {
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
} satisfies ZodRawShapeCompat;

const cacheUnpinInputSchema = {
  pinId: z.string().describe('Pin ID from cache_list_pins'),
} satisfies ZodRawShapeCompat;

const cacheListPinsInputSchema = {
  resource_type: pinResourceEnum.optional().describe('Filter by type'),
} satisfies ZodRawShapeCompat;

const cacheRefreshPinInputSchema = {
  pinId: z.string(),
} satisfies ZodRawShapeCompat;

const cacheDeletePinnedInputSchema = {
  pinId: z.string().optional(),
  mode: z.enum(['all', 'by_type']).optional(),
  resource_type: pinResourceEnum.optional(),
} satisfies ZodRawShapeCompat;

function registerMcpTools(server: McpServer, deps: ToolDependencies): void {
  registerNoInputTool(
    server,
    'list_courses',
    'Lists all courses the student is enrolled in on eClass.',
    () => listCourses(deps)
  );

  registerInputTool(
    server,
    'get_course_content',
    'Gets full content of a specific course.',
    courseIdInputSchema,
    ({ courseId }) => getCourseContent(courseId, deps)
  );

  registerInputTool(
    server,
    'get_section_text',
    'Fetches the literal paragraph text, embedded links, and hidden custom-layout tabs within a specific Moodle section. Provide the section URL.',
    sectionTextInputSchema,
    ({ url }) => getSectionText(url, deps)
  );

  registerInputTool(
    server,
    'get_file_text',
    'Extracts content from a course file (PDF, DOCX, PPTX). Returns text and/or images. ' +
      'For large PDFs, returns a partial result with an overview and instructions to fetch ' +
      'remaining pages using startPage/endPage parameters.',
    getFileTextInputSchema,
    ({ courseId, fileUrl, startPage, endPage }) =>
      getFileText(courseId || 'unknown', fileUrl, startPage, endPage, deps)
  );

  registerInputTool(
    server,
    'get_assignments',
    'Canonical assignment resolver. Use this first for homework, assignments, due dates, or deadlines because it checks eClass and, when needed, Cengage/WebAssign via the permanent course-platform index. It verifies active WebAssign course context and may return needs_course_activation instead of treating wrong-course landing as no assignments or auth expiry.',
    getAssignmentsInputSchema,
    (args) => getAssignments(args, false, false, deps)
  );

  registerInputTool(
    server,
    'prepare_assignment_submission',
    'Read-only preflight for future assignment submission tools. Resolves an eClass or Cengage/WebAssign assignment, checks submission state and upload constraints when available, summarizes intended local files, and returns a signed preflightRef for later confirmed writes.',
    prepareAssignmentSubmissionInputSchema,
    (args) => prepareAssignmentSubmission(args, deps)
  );

  registerInputTool(
    server,
    'get_upcoming_deadlines',
    'Returns upcoming eClass-only assignment/quiz deadlines. If this is empty for a course, call get_assignments before concluding there are no assignments.',
    getUpcomingDeadlinesInputSchema,
    ({ daysAhead, courseId }) =>
      getUpcomingDeadlines(daysAhead, courseId, false, deps)
  );

  registerInputTool(
    server,
    'get_deadlines',
    'Returns eClass-only assignment/quiz deadlines for upcoming, month, or date range scopes. For complete cross-platform answers, use get_assignments.',
    getDeadlinesInputSchema,
    (args) => getDeadlines(args, false, deps)
  );

  registerInputTool(
    server,
    'get_item_details',
    'Fetches assignment/quiz page details, optionally attaching vision instruction images (no OCR) with strict payload caps.',
    getItemDetailsInputSchema,
    (args) => getItemDetails(args, false, deps)
  );

  registerInputTool(
    server,
    'get_grades',
    "Returns the student's grades.",
    optionalCourseIdInputSchema,
    ({ courseId }) => getGrades(courseId, deps)
  );

  registerInputTool(
    server,
    'get_announcements',
    'Returns recent course announcements.',
    getAnnouncementsInputSchema,
    ({ courseId, limit }) => getAnnouncements(courseId, limit, deps)
  );

  registerNoInputTool(
    server,
    'get_exam_schedule',
    "Fetches the current student's personal exam schedule from York SIS.",
    () => getExamSchedule(deps)
  );

  registerNoInputTool(
    server,
    'get_class_timetable',
    "Fetches the current student's personal class timetable from York SIS for the current session.",
    () => getClassTimetable(deps)
  );

  registerInputTool(
    server,
    'search_professors',
    'Finds professor profiles on RateMyProfessors for York University campuses.',
    searchProfessorsInputSchema,
    (args) => searchProfessorsTool(args, deps)
  );

  registerInputTool(
    server,
    'get_professor_details',
    'Fetches detailed ratings, difficulty, and student comments for a specific professor from RateMyProfessors.',
    getProfessorDetailsInputSchema,
    (args) => getProfessorDetailsTool(args, deps)
  );

  registerInputTool(
    server,
    'discover_cengage_links',
    'Scans raw text for Cengage/WebAssign URLs and returns normalized, classified link candidates with source hints.',
    discoverCengageLinksInputSchema,
    ({ text, source, courseId, sectionUrl, sourceFile }) =>
      discoverCengageLinks({ text, source, courseId, sectionUrl, sourceFile })
  );

  registerInputTool(
    server,
    'list_cengage_courses',
    'Lists visible Cengage dashboard course materials from saved session state or a provided entry URL, including WebAssign and OWLv2/CengageNOW cards. OWLv2 courses are reported but assignment scraping is currently WebAssign-only.',
    listCengageCoursesInputSchema,
    ({ entryUrl, discoveredLink, courseQuery }) =>
      listCengageCourses({ entryUrl, discoveredLink, courseQuery }, deps)
  );

  registerInputTool(
    server,
    'get_cengage_assignments',
    'Fetches assignment list and deadlines from WebAssign-backed Cengage courses using direct course/LTI links first when provided, otherwise dashboard/index selection. Verifies the active WebAssign course context before returning rows; OWLv2/CengageNOW courses can be listed but return unsupported assignment extraction instead of being hidden.',
    getCengageAssignmentsInputSchema,
    ({
      entryUrl,
      ssoUrl,
      courseId,
      courseKey,
      courseQuery,
      allCourses,
      maxCourses,
      maxAssignmentsPerCourse,
    }) =>
      getCengageAssignments(
        {
          entryUrl,
          ssoUrl,
          courseId,
          courseKey,
          courseQuery,
          allCourses,
          maxCourses,
          maxAssignmentsPerCourse,
        },
        deps
      )
  );

  registerInputTool(
    server,
    'get_cengage_assignment_details',
    'Opens a specific Cengage/WebAssign assignment and extracts question-level prompts, scoring hints, answers, and resource links. Verifies active WebAssign course context before selecting details; needs_course_activation means WebAssign landed in the wrong course.',
    getCengageAssignmentDetailsInputSchema,
    ({
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
      includeAssetInventory,
      includeRenderedMedia,
      maxRenderedImages,
      maxCaptureUnits,
      maxCapturePerQuestion,
      maxInteractiveAssets,
      maxMediaAssets,
      maxMediaPayloadBytes,
      minTextForSafeText,
      captureDpi,
      maxQuestions,
      maxQuestionTextChars,
      maxAnswerTextChars,
    }) =>
      getCengageAssignmentDetails(
        {
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
          includeAssetInventory,
          includeRenderedMedia,
          maxRenderedImages,
          maxCaptureUnits,
          maxCapturePerQuestion,
          maxInteractiveAssets,
          maxMediaAssets,
          maxMediaPayloadBytes,
          minTextForSafeText,
          captureDpi,
          maxQuestions,
          maxQuestionTextChars,
          maxAnswerTextChars,
        },
        deps
      )
  );

  registerInputTool(
    server,
    'clear_cache',
    'Clears default (TTL) cache for the given scope. User-pinned entries are never removed; use cache_delete_pinned to remove pinned data. Response states that pins are unchanged.',
    clearCacheInputSchema,
    ({ scope }) => clearCache(scope)
  );

  registerNoInputTool(
    server,
    'cache_health',
    'Reports read-only aggregate cache and pin health plus process-local cache metrics. Does not clear, refresh, authenticate, or scrape.',
    () => cacheHealth()
  );

  registerInputTool(
    server,
    'cache_pin',
    'Pin a cached resource (file, section text, or course content) so it is kept past TTL until unpinned. Requires the resource to already exist in cache. Subject to ECLASS_MCP_PIN_QUOTA_BYTES. For file: fileUrl (+ optional startPage/endPage). For sectiontext: url. For content: courseId.',
    cachePinInputSchema,
    (args) => cachePin(args)
  );

  registerInputTool(
    server,
    'cache_unpin',
    'Remove a pin from the registry without deleting the cache file. Use cache_delete_pinned to remove stored bytes.',
    cacheUnpinInputSchema,
    ({ pinId }) => cacheUnpin({ pinId })
  );

  registerInputTool(
    server,
    'cache_list_pins',
    'List pinned resources and quota usage (used_bytes vs limit_bytes).',
    cacheListPinsInputSchema,
    ({ resource_type }) => cacheListPins({ resource_type })
  );

  registerInputTool(
    server,
    'cache_refresh_pin',
    'Re-fetch and refresh the underlying cached data for a pin (resets TTL for that cache entry).',
    cacheRefreshPinInputSchema,
    ({ pinId }) => cacheRefreshPin({ pinId })
  );

  registerInputTool(
    server,
    'cache_delete_pinned',
    'Explicitly delete pinned cache files and remove pin records. Pass pinId for one item, or mode=all to clear all pins, or mode=by_type with resource_type.',
    cacheDeletePinnedInputSchema,
    (args) => cacheDeletePinned(args)
  );
}

export function createMcpServer(
  deps: ToolDependencies = createDefaultToolDependencies()
): McpServer {
  const server = new McpServer({
    name: 'eclass-mcp',
    version: '1.0.0-beta.3',
  });
  registerMcpTools(server, deps);
  return server;
}

/* v8 ignore start -- CLI auth/stdio startup is exercised manually by MCP hosts. */
async function cleanupStartupFailure(): Promise<void> {
  await Promise.allSettled([
    stopAuthServer(),
    closeDefaultEclassHybridProvider(),
    eclassScraper.close(),
    closeActiveCengageScrapers(),
    closeActiveSisBrowsers(),
  ]);
}

async function main() {
  let shutdown: ReturnType<typeof createShutdownController> | undefined =
    undefined;

  try {
    // Always start auth server in background so it's ready for redirects
    await startAuthServer();

    if (!isSecureSessionConfigured()) {
      bootstrapLog.error(
        'Secure session storage is not configured. Set ECLASS_MCP_SESSION_SECRET in .env before authenticating.'
      );
    } else {
      try {
        if (!isSessionValid()) {
          bootstrapLog.warn(
            'eClass session not found or stale. Opening login window...'
          );
          openAuthWindow();
        } else {
          bootstrapLog.info('eClass session check: Local session file found.');
        }
      } catch (error) {
        if (error instanceof SecureSessionStorageError) {
          bootstrapLog.error(
            { reason: error.reason },
            'Secure session storage is unavailable. Clear old auth sessions or check ECLASS_MCP_SESSION_SECRET.'
          );
        } else {
          throw error;
        }
      }
    }

    const transport = new StdioServerTransport();
    const server = createMcpServer();
    shutdown = createShutdownController({
      logger: shutdownLog,
      exit: (code) => process.exit(code),
      closers: [
        { name: 'mcp_server', close: () => server.close() },
        { name: 'stdio_transport', close: () => transport.close() },
        { name: 'auth_server', close: () => stopAuthServer() },
        {
          name: 'eclass_hybrid_provider',
          close: () => closeDefaultEclassHybridProvider(),
        },
        { name: 'eclass_scraper', close: () => eclassScraper.close() },
        {
          name: 'cengage_scrapers',
          close: () => closeActiveCengageScrapers(),
        },
        { name: 'sis_browsers', close: () => closeActiveSisBrowsers() },
      ],
    });
    shutdown.bindOnClose(transport);
    shutdown.installSignalHandlers();

    await server.connect(transport);
  } catch (error) {
    if (shutdown) {
      await shutdown.shutdown('startup_error');
    } else {
      await cleanupStartupFailure();
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    rootLogger.fatal({ err: error }, 'Fatal error in MCP server');
    process.exit(1);
  });
}
/* v8 ignore stop */
