# E2E Run Log

## Run [1] — 2026-03-22 (Phase: Initial E2E Integration)

### Environment
| Field | Value |
|-------|-------|
| Date | 2026-03-22 |
| OS | Windows (PowerShell) |
| Node version (`node -v`) | v24.11.1 |
| Claude Desktop version | N/A (Inspector Pass) |
| Repo commit (`git rev-parse HEAD`) | c885853 |
| Cache state | warm |
| Session state | fresh (re-authed during run) |

### Inspector Smoke Pass (Server-only)

*Pre-flight check to verify raw JSON before host-level testing.*

| # | Tool | Status | Findings / Raw JSON (redacted) |
|---|------|--------|------------------------------|
| I-1 | `list_courses` | Pass | Returned 29 courses; IDs and names populated |
| I-2 | `get_course_content` | Pass | Course ID 163568: 11 sections extracted; items correctly typed (resource, announcement, quiz) |
| I-3 | `get_section_text` | Pass | Successfully extracted **tabbed content** (7 tabs) for section 3 of course 148310; `mainText` and `links` populated |
| I-4 | `get_file_text` | Pass | Hybrid PDF analyzer confirmed: text pages returned as text, images returned as base64 |
| I-5 | `get_upcoming_deadlines` | Pass | Successfully scraped Timeline: 6 upcoming items found across 3 courses (EECS1021, ENG1102, CHEM1100) |
| I-6 | `get_deadlines` (month) | Pass | 8 assignments found for Feb 2026; status and grades correctly merged |
| I-7 | `get_deadlines` (range) | Skip | Skipping during Inspector pre-flight; will test in Claude Desktop |
| I-8 | `get_item_details` | Pass | Assignment 4068184: 3 instructional screenshots found; description, fields, and attachments (PDF) captured |
| I-9 | `get_grades` | Pass | Course ID 149363: 11 gradebook rows extracted; successfully captured detailed `feedback` text |
| I-10| `get_announcements` | Pass | Successfully extracted 10 items; **Note**: detected duplicate entries (thread vs summary) requiring future deduping |

### Claude Desktop Tool Matrix (E2E)

| # | Tool | Prompt used | Result | Evidence | Issue # | Notes |
|---|------|-------------|--------|----------|---------|-------|
| 1 | `list_courses` | "What courses am I enrolled in?" | Pass | Claude summarized Winter 2025-2026 courses correctly (EECS 1021, MATH 1014, etc.) | | |
| 2 | `get_course_content` | "List sections and files for course 149363" | Pass | Detailed breakdown of ENG 1102 (Units 1-10, Project Phases 1-3) correctly mapped to Moodle folders | | |
| 3 | `get_section_text` | "Open this section URL and summarize the text..." | Pass | Successfully synthesized content from multiple tabs (In-person, Social media, SCLD) into a cohesive summary | | |
| 4 | `get_file_text` | "Read this file: <fileUrl>" | Pass | Accurate summary of PHYS 1801 PDF Course Outline: grading options, policies, and key dates extracted | | |
| 5 | `get_upcoming_deadlines` | "What’s due in the next two weeks?" | Pass | Successfully listed EECS 1021 and ENG 1102 items; **Note**: Claude cross-referenced these with the previously read PDF for context | | |
| 6 | `get_deadlines` (month) | "What deadlines are in February 2026?" | Pass | Correctly listed 8 February items with submission status and grades (including flagging a 0 for Lab04B) | | |
| 7 | `get_deadlines` (range) | "Assignments due between 2026-03-25 and 2026-03-31" | Pass | Successfully filtered for 3 items; **Note**: detected time discrepancy between Index and Detailed views | | |
| 8 | `get_item_details` | "Get full details for..." | Pass | **Vision confirmed**: Claude successfully transcribed the math problems (Q1-Q4) from the description screenshots | | |
| 9 | `get_grades` | "What are my grades for ENG 1102?" | Pass | Accurate summary of 8+ items; Claude successfully paraphrased long feedback text into actionable bullet points | | |
| 10 | `get_announcements` | "Recent announcements for course 149363" | Pass | Successfully summarized MATH 1014 and ENG 1102 announcements; duplicates noted in pre-flight but handled by Claude | | |
| S | Session expiry | "What are my grades?" (after deleting session.json) | Pass | Prompted for re-auth via localhost:3000/auth as expected | | |

---

## Run [2] — 2026-03-22 (Phase 1.1: SIS Integration)

### Environment
| Field | Value |
|-------|-------|
| Date | 2026-03-22 |
| OS | Windows (PowerShell) |
| Node version | v24.11.1 |
| Claude Version | Stable |
| Repo commit | c885853 |
| Cache state | warm |
| Session state | reused (SIS cookies bridged) |

### Inspector Smoke Pass (Server-only)
| # | Tool | Status | Findings |
|---|------|--------|----------|
| I-11 | `get_exam_schedule` | Pass | Successfully parsed 4 undergrad exams; dual course codes handled (`SC MATH 1028 / LE EECS 1028`) |
| I-12 | `get_class_timetable` | Pass | Successfully navigated session selection; returned 11 timetable entries (LECT, LAB, TUTR) |

### Claude Desktop Tool Matrix (E2E)
| # | Tool | Prompt used | Result | Evidence | Issue # | Notes |
|---|------|-------------|--------|----------|---------|-------|
| 11 | `get_exam_schedule` | "What are my upcoming exams?" | Pass | Claude correctly listed dates/times for 4 exams; identified 3:00 credit weight | | |
| 12 | `get_class_timetable` | "What is my class schedule?" | Pass | Detailed summary of 11 items; Claude identified morning/evening splits correctly | | |

---

## 📋 Run Link Template (Phase: March 22, 2026)

*Use this template for future runs. The "Inspector Smoke Pass" was added on 2026-03-22 to ensure server stability before host testing.*

### Environment
| Field | Value |
|---|---|
| Date | |
| OS | |
| Node version | |
| Claude Version | |
| Repo commit | |
| Cache state | cold / warm |
| Session state | fresh / reused |

### Inspector Smoke Pass (Server-only)
| # | Tool | Status | Findings |
|---|------|--------|----------|
| I-1 | `list_courses` | | |
| I-2 | `get_course_content` | | |
| I-3 | `get_section_text` | | |
| I-4 | `get_file_text` | | |
| I-5 | `get_upcoming_deadlines` | | |
| I-6 | `get_deadlines` (month) | | |
| I-7 | `get_deadlines` (range) | | |
| I-8 | `get_item_details` | | |
| I-9 | `get_grades` | | |
| I-10| `get_announcements` | | |
| I-11| `get_exam_schedule` | | |
| I-12| `get_class_timetable` | | |

### Claude Desktop Tool Matrix (E2E)
| # | Tool | Prompt used | Result | Evidence | Issue # | Notes |
|---|------|-------------|--------|----------|---------|-------|
| 1 | `list_courses` | | | | | |
| 2 | `get_course_content` | | | | | |
| 3 | `get_section_text` | | | | | |
| 4 | `get_file_text` | | | | | |
| 5 | `get_upcoming_deadlines` | | | | | |
| 6 | `get_deadlines` (month) | | | | | |
| 7 | `get_deadlines` (range) | | | | | |
| 8 | `get_item_details` | | | | | |
| 9 | `get_grades` | | | | | |
| 10 | `get_announcements` | | | | | |
| 11 | `get_exam_schedule` | | | | | |
| 12 | `get_class_timetable` | | | | | |
| S | Session expiry | | | | | |

### Definitions
- **Pass:** tool was invoked and response passed all structural checks for that row.
- **Fail:** tool was not invoked, threw an error, or response failed a structural check. File an issue.
- **Skip:** tool could not be tested (e.g. no PDF in courses). Document reason in Notes.
- **Evidence:** paste the raw JSON snippet returned (redact personal info), or note "no JSON visible."
- **Issue #:** record the GitHub issue number for any Fail row.

### Issues filed
_List any GitHub issue numbers created from failures._
