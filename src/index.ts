import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Force absolute path for .env so Claude Desktop can find it
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

import { isSessionValid } from './scraper/session';
import { startAuthServer } from './auth/server';
import { listCourses } from './tools/courses';
import { getCourseContent } from './tools/content';
import { getFileText } from './tools/files';
import { getUpcomingDeadlines, getDeadlines, getItemDetails } from './tools/deadlines';
import { getGrades } from './tools/grades';
import { getAnnouncements } from './tools/announcements';

// Create the MCP server
const server = new McpServer({
  name: "eclass-mcp",
  version: "1.0.0"
});

// Register all tools with any casting to bypass literal-type inference issues
// and ensure we move forward with Task 8.
server.tool(
  "list_courses",
  "Lists all courses the student is enrolled in on eClass.",
  {},
  (async () => await listCourses()) as any
);

server.tool(
  "get_course_content",
  "Gets full content of a specific course.",
  { courseId: z.string().describe("The course ID") },
  (async ({ courseId }: any) => await getCourseContent(courseId)) as any
);

server.tool(
  "get_file_text",
  "Extracts content from a course file (PDF, DOCX, PPTX). Returns text and/or images. " +
  "For large PDFs, returns a partial result with an overview and instructions to fetch " +
  "remaining pages using startPage/endPage parameters.",
  { 
    courseId: z.string().describe("The course ID"),
    fileUrl: z.string().describe("The file URL"),
    startPage: z.number().optional().describe("Start page for PDF extraction (1-indexed, default: 1)"),
    endPage: z.number().optional().describe("End page for PDF extraction (1-indexed, default: startPage + 49)")
  },
  (async ({ courseId, fileUrl, startPage, endPage }: any) => await getFileText(courseId, fileUrl, startPage, endPage)) as any
);

server.tool(
  "get_upcoming_deadlines",
  "Returns upcoming assignment deadlines.",
  {
    daysAhead: z.number().optional().describe("Days ahead (default 14)"),
    courseId: z.string().optional().describe("Filter by course ID")
  },
  (async ({ daysAhead, courseId }: any) => await getUpcomingDeadlines(daysAhead, courseId)) as any
);

server.tool(
  "get_deadlines",
  "Returns assignment/quiz deadlines for upcoming, month, or date range scopes.",
  {
    courseId: z.string().optional().describe("Filter by course ID"),
    scope: z.enum(["upcoming", "month", "range"]).optional().describe("Scope (default upcoming)"),
    month: z.number().int().min(1).max(12).optional().describe("Month (1-12) when scope=month"),
    year: z.number().int().min(2000).max(2100).optional().describe("Year when scope=month"),
    from: z.string().optional().describe("Start date/time (ISO or YYYY-MM-DD) when scope=range"),
    to: z.string().optional().describe("End date/time (ISO or YYYY-MM-DD) when scope=range"),
    includeDetails: z.boolean().optional().describe("If true, fetch details for first maxDetails items"),
    maxDetails: z.number().int().min(0).max(25).optional().describe("Max items to deep-fetch when includeDetails=true (default 7)")
  },
  (async (args: any) => await getDeadlines(args)) as any
);

server.tool(
  "get_item_details",
  "Fetches assignment/quiz page details (description/status/grade when available).",
  {
    url: z.string().describe("Assignment or quiz URL"),
  },
  (async (args: any) => await getItemDetails(args)) as any
);

server.tool(
  "get_grades",
  "Returns the student's grades.",
  { courseId: z.string().optional().describe("Filter by course ID") },
  (async ({ courseId }: any) => await getGrades(courseId)) as any
);

server.tool(
  "get_announcements",
  "Returns recent course announcements.",
  {
    courseId: z.string().optional().describe("Filter by course ID"),
    limit: z.number().optional().describe("Max number (default 10)")
  },
  (async ({ courseId, limit }: any) => await getAnnouncements(courseId, limit)) as any
);

// Main startup
async function main() {
  // Always start auth server in background so it's ready for redirects
  startAuthServer();

  if (!isSessionValid()) {
    console.error('eClass session not found or stale. Opening login window...');
    // openAuthWindow(); // Optionally open on startup if you want it super-automatic
  } else {
    console.error('eClass session check: Local session file found.');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});
