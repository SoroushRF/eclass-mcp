import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isSessionValid } from './scraper/session.js';
import { startAuthServer } from './auth/server.js';
import { listCourses } from './tools/courses.js';
import { getCourseContent } from './tools/content.js';
import { getFileText } from './tools/files.js';
import { getUpcomingDeadlines } from './tools/deadlines.js';
import { getGrades } from './tools/grades.js';
import { getAnnouncements } from './tools/announcements.js';

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  if (!isSessionValid()) {
    startAuthServer(); 
    console.error('eClass session not found. Visit http://localhost:3000/auth');
  } else {
    console.error('eClass session valid.');
  }
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error);
  process.exit(1);
});
