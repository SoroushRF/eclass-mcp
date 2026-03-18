# eClass MCP — Implementation Plan
> Feed this entire document to your AI agent. The agent must complete one task at a time and report back before proceeding. It must never jump ahead.

---

## Project Overview

Build a local MCP server in TypeScript that connects Claude Desktop to York University's eClass platform. The server runs on localhost, scrapes eClass via Playwright (authenticated session), parses course files, and exposes structured data to Claude via 6 MCP tools.

**Stack:**
- TypeScript + Node.js
- `@modelcontextprotocol/sdk` — MCP server
- `playwright` — browser automation + session management
- `pdf-parse` — PDF text extraction
- `mammoth` — DOCX text extraction
- `node-cron` — deadline reminder scheduling
- No database — flat JSON files on disk

**Final folder structure:**
```
eclass-mcp/
├── src/
│   ├── index.ts
│   ├── tools/
│   │   ├── courses.ts
│   │   ├── content.ts
│   │   ├── files.ts
│   │   ├── deadlines.ts
│   │   ├── grades.ts
│   │   └── announcements.ts
│   ├── scraper/
│   │   ├── session.ts
│   │   └── eclass.ts
│   ├── parser/
│   │   ├── pdf.ts
│   │   ├── docx.ts
│   │   └── pptx.ts
│   ├── auth/
│   │   └── server.ts
│   └── cache/
│       └── store.ts
├── .eclass-mcp/
│   ├── session.json      ← gitignored
│   └── cache/            ← gitignored
├── .env                  ← gitignored
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## AGENT INSTRUCTIONS

> You are implementing the eClass MCP server step by step.
> 
> **Rules:**
> 1. Complete ONE task at a time
> 2. When a task is done, stop and report back with: what you did, what files were created/modified, and any issues encountered
> 3. NEVER move to the next task without explicit confirmation from the user
> 4. If you are uncertain about something mid-task, stop and ask before proceeding
> 5. If a task fails, report the failure clearly with the error — do not try to skip or work around it silently

---

## Task 1 — Project scaffolding

**Goal:** Create the project folder structure and all config files. No logic yet — just the skeleton.

**Steps:**
1. Create the root folder `eclass-mcp/`
2. Run `npm init -y` inside it
3. Install dependencies:
   ```
   npm install @modelcontextprotocol/sdk playwright pdf-parse mammoth node-cron dotenv
   npm install -D typescript @types/node ts-node nodemon
   ```
4. Install Playwright browsers:
   ```
   npx playwright install chromium
   ```
5. Create `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "commonjs",
       "lib": ["ES2020"],
       "outDir": "./dist",
       "rootDir": "./src",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true,
       "resolveJsonModule": true
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist"]
   }
   ```
6. Create `.gitignore`:
   ```
   node_modules/
   dist/
   .env
   .eclass-mcp/
   *.json.bak
   ```
7. Create `.env.example`:
   ```
   ECLASS_URL=https://eclass.yorku.ca
   AUTH_PORT=3000
   CACHE_DIR=.eclass-mcp/cache
   SESSION_FILE=.eclass-mcp/session.json
   ```
8. Create `.env` with the same content (this one is gitignored and holds real values)
9. Create all empty placeholder files in the folder structure above (just empty exports for now):
   - `src/index.ts`
   - `src/tools/courses.ts`
   - `src/tools/content.ts`
   - `src/tools/files.ts`
   - `src/tools/deadlines.ts`
   - `src/tools/grades.ts`
   - `src/tools/announcements.ts`
   - `src/scraper/session.ts`
   - `src/scraper/eclass.ts`
   - `src/parser/pdf.ts`
   - `src/parser/docx.ts`
   - `src/parser/pptx.ts`
   - `src/auth/server.ts`
   - `src/cache/store.ts`
10. Add scripts to `package.json`:
    ```json
    "scripts": {
      "dev": "nodemon --exec ts-node src/index.ts",
      "build": "tsc",
      "start": "node dist/index.js"
    }
    ```
11. Create the `.eclass-mcp/` folder and `.eclass-mcp/cache/` subfolder

**Report back:** Confirm all files exist, show the folder tree, confirm `npm install` completed without errors.

---

## Task 2 — Cache store

**Goal:** Build the disk-based cache utility. Everything else depends on this.

**File:** `src/cache/store.ts`

**What it does:**
- Reads and writes JSON files to `.eclass-mcp/cache/`
- Has a TTL (time-to-live) system — cached data expires after N minutes
- Functions needed:
  - `get(key: string): T | null` — returns cached value or null if missing/expired
  - `set(key: string, value: T, ttlMinutes: number): void` — writes value with expiry timestamp
  - `invalidate(key: string): void` — deletes a cache entry
  - `clear(): void` — wipes entire cache

**Cache file format** (one JSON file per key, e.g. `cache/courses.json`):
```json
{
  "expires_at": "2025-03-20T10:00:00Z",
  "data": { ... }
}
```

**TTL rules to hardcode as constants:**
```typescript
export const TTL = {
  COURSES: 60 * 24,      // 24 hours
  CONTENT: 60 * 6,       // 6 hours
  DEADLINES: 60 * 2,     // 2 hours
  ANNOUNCEMENTS: 60,     // 1 hour
  GRADES: 60 * 12,       // 12 hours
  FILES: 60 * 24 * 7,    // 7 days (parsed file text rarely changes)
}
```

**Report back:** Show the completed `store.ts` file and confirm it compiles without TypeScript errors (`npx tsc --noEmit`).

---

## Task 3 — Session management

**Goal:** Build the session layer that saves and loads the eClass authentication cookie to/from disk.

**File:** `src/scraper/session.ts`

**What it does:**
- Saves Playwright browser cookies to `.eclass-mcp/session.json`
- Loads cookies back and injects them into a Playwright browser context
- Detects if the session is expired or missing
- Exports:
  - `saveSession(cookies: Cookie[]): void`
  - `loadSession(): Cookie[] | null` — returns null if file missing or expired
  - `isSessionValid(): boolean`
  - `clearSession(): void`

**Session file format:**
```json
{
  "saved_at": "2025-03-18T10:00:00Z",
  "cookies": [ ...playwright cookie objects... ]
}
```

**Expiry logic:** Consider a session stale after 60 hours (gives buffer before York's ~72 hour expiry). When stale, `isSessionValid()` returns false and the auth flow is triggered.

**Report back:** Show completed `session.ts`, confirm it compiles.

---

## Task 4 — Auth server

**Goal:** Build the local HTTP server that handles eClass login via a real Playwright browser window.

**File:** `src/auth/server.ts`

**What it does:**
- Starts a small Express-like HTTP server on `localhost:3000` (use Node's built-in `http` module, no Express needed)
- Only two routes:
  - `GET /auth` — launches a visible Playwright browser window pointing to eClass login page, waits for the user to log in and land on the eClass dashboard, captures all cookies, saves session via `saveSession()`, closes browser, returns a success HTML page: `<h2>Connected! You can close this tab and return to Claude.</h2>`
  - `GET /status` — returns `{ "authenticated": true/false }` JSON based on `isSessionValid()`
- The server only needs to run temporarily during auth — it can be started on demand, not always running

**Important:** The Playwright browser for auth must be `headless: false` (visible to user) so they can interact with the login form and 2FA.

**Report back:** Show completed `auth/server.ts`, confirm it compiles.

---

## Task 5 — eClass scraper

**Goal:** Build the core scraping logic that fetches data from eClass pages using a saved session.

**File:** `src/scraper/eclass.ts`

**What it does:**
- Creates a Playwright browser context with saved session cookies injected
- All scraping is `headless: true` (invisible)
- If any request redirects to the login page, throws a specific error: `SessionExpiredError`
- Exports these functions (return mock/empty data for now — real selectors come in Task 8):

```typescript
// Returns list of enrolled courses
getCourses(): Promise<Course[]>
// Course type: { id: string, name: string, code: string, url: string }

// Returns full content of a course page
getCourseContent(courseId: string): Promise<CourseContent>
// CourseContent type: { sections: Section[], files: FileItem[], assignments: Assignment[], announcements: Announcement[] }

// Returns upcoming assignments across all or one course
getDeadlines(courseId?: string): Promise<Assignment[]>
// Assignment type: { id: string, title: string, courseId: string, courseName: string, dueDate: Date, submitted: boolean }

// Returns grades
getGrades(courseId?: string): Promise<Grade[]>
// Grade type: { item: string, courseId: string, grade: string, max: string, feedback: string }

// Returns announcements
getAnnouncements(courseId?: string, limit?: number): Promise<Announcement[]>
// Announcement type: { id: string, title: string, body: string, author: string, date: Date, courseId: string }

// Downloads a file and returns its raw buffer + mime type
downloadFile(fileUrl: string): Promise<{ buffer: Buffer, mimeType: string, filename: string }>
```

**SessionExpiredError:**
```typescript
export class SessionExpiredError extends Error {
  constructor() {
    super('eClass session expired. Please re-authenticate at http://localhost:3000/auth')
    this.name = 'SessionExpiredError'
  }
}
```

**Report back:** Show completed `eclass.ts`, confirm it compiles.

---

## Task 6 — File parsers

**Goal:** Build the three file parsing utilities.

**Files:** `src/parser/pdf.ts`, `src/parser/docx.ts`, `src/parser/pptx.ts`

**pdf.ts:**
- Uses `pdf-parse`
- `parsePdf(buffer: Buffer): Promise<string>` — returns extracted text
- Trim whitespace, collapse multiple newlines to max 2

**docx.ts:**
- Uses `mammoth`
- `parseDocx(buffer: Buffer): Promise<string>` — returns extracted plain text (not HTML)

**pptx.ts:**
- No great npm library for this — use a simple XML extraction approach
- A `.pptx` file is a ZIP archive. Use Node's built-in `zlib` + `fs` or the `adm-zip` package
- Install: `npm install adm-zip @types/adm-zip`
- Extract text from `ppt/slides/slide*.xml` files inside the ZIP
- Strip XML tags, return concatenated text per slide separated by `\n--- Slide N ---\n`
- `parsePptx(buffer: Buffer): Promise<string>`

**Shared util in each parser:** If parsing fails, return empty string and log the error — never throw. A failed parse shouldn't crash the MCP.

**Report back:** Show all three parser files, confirm they compile.

---

## Task 7 — MCP tools (structure only)

**Goal:** Build all 6 MCP tool files with full type signatures and structure, but calling the scraper functions from Task 5 (which return empty data for now). Wire up error handling for `SessionExpiredError`.

**Pattern every tool must follow:**
```typescript
import { scraper } from '../scraper/eclass.js'
import { SessionExpiredError } from '../scraper/eclass.js'
import { cache, TTL } from '../cache/store.js'

export async function listCourses() {
  try {
    const cached = cache.get<Course[]>('courses')
    if (cached) return { content: [{ type: 'text', text: JSON.stringify(cached) }] }
    
    const courses = await scraper.getCourses()
    cache.set('courses', courses, TTL.COURSES)
    return { content: [{ type: 'text', text: JSON.stringify(courses) }] }
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return { content: [{ type: 'text', text: e.message }] }
    }
    throw e
  }
}
```

**Tools to build:**

`src/tools/courses.ts` → `listCourses()`

`src/tools/content.ts` → `getCourseContent(courseId: string)`

`src/tools/files.ts` → `getFileText(courseId: string, fileId: string)`
- This one calls `scraper.downloadFile()` then routes to the right parser based on file extension
- Caches parsed text to disk keyed by `file_${fileId}`

`src/tools/deadlines.ts` → `getUpcomingDeadlines(daysAhead?: number, courseId?: string)`
- Default `daysAhead` = 14
- Filters assignments to only those due within `daysAhead` days

`src/tools/grades.ts` → `getGrades(courseId?: string)`

`src/tools/announcements.ts` → `getAnnouncements(courseId?: string, limit?: number)`
- Default `limit` = 10

**Report back:** Show all 6 tool files, confirm they compile.

---

## Task 8 — MCP server entry point

**Goal:** Wire everything together into the MCP server. This is the file Claude Desktop talks to.

**File:** `src/index.ts`

**What it does:**
- Creates an MCP server using `@modelcontextprotocol/sdk`
- Registers all 6 tools with proper names, descriptions, and input schemas
- Starts the server using stdio transport (this is how Claude Desktop communicates with it)
- On startup, checks `isSessionValid()` — if false, starts the auth HTTP server on port 3000 and logs a message

**Tool registrations (names and descriptions matter — Claude reads these):**

```typescript
server.tool(
  "list_courses",
  "Lists all courses the student is enrolled in on eClass. Call this first to get course IDs needed for other tools.",
  {},
  listCourses
)

server.tool(
  "get_course_content",
  "Gets full content of a specific course including sections, file listings, assignments, and announcements. Requires a course ID from list_courses.",
  { courseId: z.string().describe("The course ID from list_courses") },
  ({ courseId }) => getCourseContent(courseId)
)

server.tool(
  "get_file_text",
  "Downloads and extracts text from a course file (PDF, DOCX, or PPTX). Use this to read lecture slides, notes, or any course document. Requires course ID and file ID from get_course_content.",
  {
    courseId: z.string(),
    fileId: z.string().describe("The file ID from get_course_content")
  },
  ({ courseId, fileId }) => getFileText(courseId, fileId)
)

server.tool(
  "get_upcoming_deadlines",
  "Returns upcoming assignment deadlines. Use when the student asks what is due, what they need to do, or wants to plan their week. Optionally filter by course or number of days ahead.",
  {
    daysAhead: z.number().optional().describe("How many days ahead to look. Default is 14."),
    courseId: z.string().optional().describe("Filter to a specific course. Leave empty for all courses.")
  },
  ({ daysAhead, courseId }) => getUpcomingDeadlines(daysAhead, courseId)
)

server.tool(
  "get_grades",
  "Returns the student's grades. Use when asked about marks, scores, or academic performance.",
  {
    courseId: z.string().optional().describe("Filter to a specific course. Leave empty for all courses.")
  },
  ({ courseId }) => getGrades(courseId)
)

server.tool(
  "get_announcements",
  "Returns recent course announcements from professors. Use when asked about news, updates, or messages from instructors.",
  {
    courseId: z.string().optional(),
    limit: z.number().optional().describe("Max number of announcements to return. Default is 10.")
  },
  ({ courseId, limit }) => getAnnouncements(courseId, limit)
)
```

**Startup logic:**
```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const transport = new StdioServerTransport()
await server.connect(transport)

if (!isSessionValid()) {
  startAuthServer() // starts localhost:3000/auth
  console.error('eClass session not found. Please visit http://localhost:3000/auth to connect your eClass account.')
}
```

**Note:** Use `console.error` not `console.log` for all server-side logging — stdout is reserved for MCP protocol communication.

**Report back:** Show completed `index.ts`, confirm it compiles with `npx tsc --noEmit`.

---

## Task 9 — Claude Desktop config

**Goal:** Create the config snippet and a helper script that adds the MCP to Claude Desktop automatically.

**Steps:**

1. Create `claude-config-snippet.json` in the project root:
```json
{
  "mcpServers": {
    "eclass": {
      "command": "node",
      "args": ["FULL_PATH_TO_PROJECT/dist/index.js"]
    }
  }
}
```

2. Create `scripts/setup-claude.sh` — a bash script that:
   - Detects the OS (macOS or Windows)
   - Finds the `claude_desktop_config.json` file at its standard location:
     - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
     - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - If the file doesn't exist, creates it with the snippet
   - If it exists, merges the `eclass` entry into the existing `mcpServers` object without overwriting other MCPs
   - Prints: `Done! Restart Claude Desktop to activate eClass MCP.`

3. Make the script executable: `chmod +x scripts/setup-claude.sh`

4. Add to `package.json` scripts:
```json
"setup": "npm run build && bash scripts/setup-claude.sh"
```

So the full user setup is just:
```bash
git clone <repo>
cd eclass-mcp
npm install
npm run setup
# Restart Claude Desktop
```

**Report back:** Show the setup script, confirm `npm run build` completes successfully.

---

## Task 10 — Real eClass selectors

**Goal:** Fill in the actual Playwright selectors in `eclass.ts` to scrape real data from York's eClass.

> ⚠️ This task requires testing against the live eClass site. The agent must be connected to the internet and have a valid eClass session available.

**Steps:**

1. Manually log into eClass at `https://eclass.yorku.ca` and inspect the page structure using browser DevTools
2. Identify selectors for:
   - Course cards on the dashboard (course name, course code, link to course page)
   - Assignment items on a course page (title, due date, submission status)
   - Grade items in the gradebook (item name, grade, max grade)
   - Announcement items (title, body, author, date)
   - File/resource links (filename, file URL, file type)
3. Implement each `getCourses()`, `getCourseContent()`, `getDeadlines()`, `getGrades()`, `getAnnouncements()`, `downloadFile()` function with real selectors
4. Test each function individually by running a small test script `scripts/test-scraper.ts` that calls each function and prints the result
5. Fix any selector issues until all 6 functions return real data

**Report back:** Show the completed `eclass.ts` with real selectors, show sample output from each function in the test script.

---

## Task 11 — End-to-end test with Claude Desktop

**Goal:** Verify the entire system works from Claude's perspective.

**Steps:**
1. Run `npm run setup` to build and register the MCP
2. Restart Claude Desktop
3. Open Claude Desktop and verify the eClass MCP appears in the tools list (hammer icon)
4. If no session exists, visit `http://localhost:3000/auth` and log into eClass
5. Ask Claude each of the following and confirm it returns real data:
   - "What courses am I enrolled in?"
   - "What assignments do I have due in the next 2 weeks?"
   - "What are my grades?"
   - "Any recent announcements?"
   - "What files are in my [course name] course?"
   - "Read me the lecture notes from [file name]"
6. Simulate a session expiry by deleting `.eclass-mcp/session.json` and asking Claude a question — confirm it responds with the re-auth message and `localhost:3000/auth` link

**Report back:** Confirm each test query works, show Claude's actual responses, report any failures.

---

## Task 12 — Cron notifications

**Goal:** Add proactive deadline reminders that run on a schedule.

**File:** `src/notifications/cron.ts`

**What it does:**
- Uses `node-cron` to run a check every morning at 8am
- Fetches deadlines for the next 48 hours using `getDeadlines()`
- If any deadlines found, writes a notification file to `.eclass-mcp/notifications.json`
- Uses `node-notifier` (install it: `npm install node-notifier @types/node-notifier`) to send a desktop OS notification listing what's due

**Schedule:** `0 8 * * *` (8am daily)

**Notification format:**
```
eClass Reminder
Due in 48hrs: Lab 3 (EECS 1022), Quiz 2 (MATH 1300)
```

**Wire into `index.ts`:** Import and start the cron job after the server connects.

**Report back:** Show `cron.ts`, confirm it compiles, describe how to verify it works (hint: temporarily change the cron schedule to `* * * * *` to fire every minute for testing).

---

## Task 13 — README

**Goal:** Write a clean README.md that a York student can follow to set up the MCP in under 5 minutes.

**Sections:**
1. What this is (2-3 sentences)
2. Requirements (Node 18+, Claude Desktop, Chrome)
3. Installation (the 4-command setup)
4. First-time auth (visit localhost:3000/auth)
5. What you can ask Claude (example prompts)
6. Re-authentication (what happens when session expires)
7. What data stays on your machine (privacy note)

**Keep it short.** No walls of text. A student should be able to skim it in 2 minutes and get running.

**Report back:** Show the completed README.

---

## Done

When Task 13 is complete, the MVP is done. At this point you have:
- A working local MCP server
- All 6 eClass tools returning real data
- Auth via local browser window
- Graceful session expiry handling
- Proactive deadline notifications
- One-command setup for new users
- Clean README

Next steps (do NOT start these without a separate conversation):
- Professor ratings via RateMyProfessors
- York subreddit search
- Multi-user support
- Deployed server (Phase 2)
