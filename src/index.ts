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
import { getUpcomingDeadlines } from './tools/deadlines';
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
  "Extracts text from a course file (PDF, DOCX, PPTX).",
  { 
    courseId: z.string().describe("The course ID"),
    fileUrl: z.string().describe("The file URL")
  },
  (async ({ courseId, fileUrl }: any) => await getFileText(courseId, fileUrl)) as any
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
