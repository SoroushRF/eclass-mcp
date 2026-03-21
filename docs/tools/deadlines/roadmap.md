# Deadlines & Details Roadmap

## 🎯 PURPOSE
Evolve the Deadlines tool into a dynamic system that can view past/future assignments and deep-dive into instructions.

---

## ✅ CURRENT TOOLING (Implemented)

### MCP tools
- **`get_deadlines`**: returns assignment/quiz deadline items for a chosen scope.
  - **Args**:
    - `courseId?`: string
    - `scope?`: `'upcoming' | 'month' | 'range'` (default: `upcoming`)
    - `month?`, `year?`: required when `scope='month'` (month is 1–12)
    - `from?`, `to?`: required when `scope='range'` (ISO or `YYYY-MM-DD`)
    - `includeDetails?`: boolean (default `false`) – deep-fetch details for first `maxDetails` items
    - `maxDetails?`: number (default `7`, max `25`)
  - **Returns**: JSON text array of `DeadlineItem` objects (and optionally `details` for first N items).
    - `DeadlineItem` now includes `courseName?` and `courseCode?` in addition to `courseId`.
    - Clients should prefer `courseCode` or `courseName` when summarizing deadlines for the user, and only fall back to raw `courseId` if no readable label exists.
  - **Current source strategy**:
    - `scope=upcoming`: calendar upcoming page (fast path).
    - `scope=month|range`: assignment-index aggregation (`mod/assign/index.php`) across one/all courses, then date filtering.

- **`get_item_details`**: fetches rich details for a single assignment/quiz URL.
  - **Args**:
    - `url` (string)
    - `includeImages?`: attach instruction screenshots as vision `image` blocks (no OCR)
    - `maxImages?`, `imageOffset?`, `maxTotalImageBytes?`: image caps + pagination controls
    - `includeCsv?`: inline CSV attachments as text
    - `csvMode?` (`auto|full|preview`), `maxCsvBytes?`, `csvPreviewLines?`, `maxCsvAttachments?`: CSV caps + truncation controls
  - **Returns**: MCP `content` blocks:
    - always a first `text` block with JSON metadata
    - optionally `image` blocks (when `includeImages=true`)
    - optionally inlined CSV `text` blocks (when `includeCsv=true`)

### Local scripts (verification)
- `scripts/test-month-view.ts`
- `scripts/test-item-details.ts`

---

## ⚠️ PREREQUISITE (for any scraping)
Playwright needs its browser installed once:

```bash
cd eclass-mcp
npx playwright install chromium
```

If you see `ENOSPC`, free disk space and re-run.

---

## 🧪 TESTING PLAYBOOK (What to run + what to expect)

### 1) Upcoming (future-only, fast)
Call:
- Tool: `get_deadlines`
- Args: `{ "scope": "upcoming" }`

Expect:
- JSON array, each item includes: `name`, `dueDate` (string), `url`, `courseId`, `type: 'assign'|'quiz'|...`
- When available, each item also includes `courseName` and `courseCode` so assistants can say `EECS1021` instead of a raw eClass course ID.
- assignment-index-backed entries also include `section`, `submission`, `grade` when available.

### 2) Month view (past + future within a month)
Call:
- Tool: `get_deadlines`
- Args: `{ "scope": "month", "month": 3, "year": 2026 }`

Expect:
- Items from that month (past + future) sourced from assignment index rows.

### 3) Range view (user-chosen past/future window)
Call:
- Tool: `get_deadlines`
- Args: `{ "scope": "range", "from": "2026-01-01", "to": "2026-01-31" }`

Expect:
- Items whose parsed due date falls inside `[from,to]`.
- For `YYYY-MM-DD`, `from` is treated as start-of-day and `to` as end-of-day.

### 4) Fetch details for one item (recommended path)
Step A: call `get_deadlines` (any scope) and pick an item’s `url`.

Step B: call:
- Tool: `get_item_details`
- Args: `{ "url": "<paste_url_here>", "includeImages": true, "includeCsv": true }` (set whichever options you need)

Expect:
- A first JSON metadata block with:
  - `kind`: `'assign'` or `'quiz'`
  - `title`
  - `descriptionText?` / `descriptionHtml?`
  - `fields?`: key/value map (submission status table or quiz summary table when present)
  - `grade?`, `feedbackText?` when visible to the student
- Plus optional extra blocks:
  - vision `image` blocks for instruction screenshots (if `includeImages=true`)
  - inline CSV `text` blocks for CSV attachments (if `includeCsv=true`)

### 5) Auto-details (based on user prompt in client)
Call:
- Tool: `get_deadlines`
- Args: `{ "scope": "upcoming", "includeDetails": true, "maxDetails": 5 }`

Expect:
- First 5 items may include a `details` property; the rest are plain `DeadlineItem` objects.

---

## 🛠️ IMPLEMENTATION PLAN (Completed)

### **PHASE 1: Dynamic Month Navigation**
- [x] **Task 1: Core Scraper Implementation**
    - Add `getMonthDeadlines(month, year)` to `EClassScraper`.
    - Use selector `.calendar_event_course` (confirmed from discovery).
    - Create `scripts/test-month-view.ts` to verify data extraction.
- [x] **Task 2: Tool Logic Refactoring**
    - Add `get_deadlines` routing for `upcoming|month|range`.
    - Replace month/range calendar dependency with assignment-index aggregation.
    - Keep `get_upcoming_deadlines` for backward compatibility.
- [x] **Task 3: MCP Schema Registration**
    - Register tool `get_deadlines` in `src/index.ts`.

### **PHASE 2: Deep-Dive Execution**
- [x] **Task 4: Detail Scraper Implementation**
    - Implement `getAssignmentDetails(url)` and `getQuizDetails(url)` in `EClassScraper`.
    - Scrape `.no-overflow` (instructions) and `.submissionstatustable` (status) when present.
- [x] **Task 5: Detail Tool Exposure**
    - Create `get_item_details` tool and add `includeDetails/maxDetails` option on `get_deadlines`.
    - Register tool in `src/index.ts`.

---

## Investigation Status
- P1 (month empty): **resolved** via assignment-index architecture.
- P2 (range empty historical): **resolved** via assignment-index architecture + date boundary normalization.
- P3/P4: in progress (details quality improvements).

---

## 🧭 RULES FOR AGENT
1.  **Strict Isolation:** Do one task at a time.
2.  **Verify First:** Every task must be verified with a test script before proceeding.
3.  **Checkpoint:** Report back to USER after EVERY task.

---
*Last Updated: 2026-03-20*
*Status: Detailed Planning Complete*
