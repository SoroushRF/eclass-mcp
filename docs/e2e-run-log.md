# E2E Run Log

Status note: **T20 (E2E engine beta)** is complete as of **2026-03-23**. **T22 (PDF pipeline)** is also complete as of **2026-03-23**; the `get_file_text` rows below reflect the shipped hybrid PDF analyzer. SIS verification was already recorded in Run [2], and RMP professor search/details were verified afterward. **T25 (scraper modularization)** regression passed on **2026-03-23** with all eClass/SIS/RMP prompts passing in the new T25 matrix. **T23 (Cengage scenario coverage)** is complete as of **2026-04-10** with passing direct-dashboard, direct-course, and auth-expired recovery rows.

## P00 Baseline Snapshot - 2026-04-10 (Pre Dashboard-First Runtime Pivot)

- `list_cengage_courses` remains explicit-link driven in runtime behavior.
- `get_cengage_assignments` remains explicit-link driven and returns `status="error"` when neither `entryUrl` nor `ssoUrl` is provided.
- Current scenario coverage remains validated at the tool-contract level (direct dashboard link, direct course link, auth-expired recovery).
- Cengage fixture tests were hardened to resolve fixtures relative to the test file path instead of `process.cwd()`, so runs are stable across workspace/repo working directories.

Inspector command used for server-only passes:
```powershell
npx.cmd @modelcontextprotocol/inspector node dist/index.js
```

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
| I-13| `search_professors` | | |
| I-14| `get_professor_details` | | |

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
| 13 | `search_professors` | | | | | |
| 14 | `get_professor_details` | | | | | |
| S | Session expiry | | | | | |

### Definitions
- **Pass:** tool was invoked and response passed all structural checks for that row.
- **Fail:** tool was not invoked, threw an error, or response failed a structural check. File an issue.
- **Skip:** tool could not be tested (e.g. no PDF in courses). Document reason in Notes.
- **Evidence:** paste the raw JSON snippet returned (redact personal info), or note "no JSON visible."
- **Issue #:** record the GitHub issue number for any Fail row.

### Issues filed
_List any GitHub issue numbers created from failures._

---

## Run [3] â€” 2026-03-23 (T25 Regression Complete)

### Summary
- T25 refactor regression passed.
- All T25 Inspector smoke rows passed.
- All T25 Claude Desktop prompts passed.
- Session expiry recovery passed.
- No shape regressions were observed in the eClass, SIS, or RMP surfaces.

## Run [4] - 2026-04-10 (T23 Cengage Scenario Coverage)

### Environment
| Field | Value |
|-------|-------|
| Date | 2026-04-10 |
| OS | Windows (PowerShell) |
| Node version | v24.11.1 |
| Repo base commit | b0caf7d |
| Execution mode | Automated scenario execution (Vitest tool-level harness) |

### Command

```powershell
npx vitest run tests/cengage-e2e-scenarios.test.ts tests/cengage-list-courses.test.ts tests/cengage-assignments-tool.test.ts
```

Result summary:
- Test Files: 3 passed
- Tests: 15 passed

### T23 Scenario Rows
| # | Scenario | Tool path exercised | Status | Evidence |
|---|----------|---------------------|--------|----------|
| C23-S1 | Direct dashboard link | `list_cengage_courses` | Pass | `tests/cengage-e2e-scenarios.test.ts` row "scenario: direct dashboard link lists courses" passed; payload `status=ok`, course list returned |
| C23-S2 | Direct course link | `get_cengage_assignments` | Pass | `tests/cengage-e2e-scenarios.test.ts` row "scenario: direct course link returns assignments" passed; payload `status=ok`, assignments array returned |
| C23-S3 | Auth-expired recovery | `list_cengage_courses` auth path | Pass | `tests/cengage-e2e-scenarios.test.ts` row "scenario: auth-expired recovery returns auth_required and retry guidance" passed; payload `status=auth_required`, `retry.afterAuth=true`, `retry.authUrl` includes `/auth-cengage` |

### Notes
- These rows validate the Cengage flows required by T23 at the tool-contract level.
- Claude Desktop and Inspector row templates for manual host verification are documented in `docs/t11-e2e-handbook.md` section 13.

## T25 Regression Template

### Environment
| Field | Value |
|-------|-------|
| Date | |
| OS | |
| Node version | |
| Claude Desktop version | |
| Repo commit | |
| Cache state | cold / warm |
| Session state | fresh / reused |

### Inspector Smoke Pass (Server-only)
| # | Tool | Status | Findings |
|---|------|--------|----------|
| T25-I1 | `list_courses` | | |
| T25-I2 | `get_course_content` | | |
| T25-I3 | `get_deadlines` | | |
| T25-I4 | `get_item_details` | | |
| T25-I5 | `get_grades` | | |
| T25-I6 | `get_announcements` | | |
| T25-I7 | `get_exam_schedule` | | |
| T25-I8 | `get_class_timetable` | | |
| T25-I9 | `search_professors` | | |
| T25-I10 | `get_professor_details` | | |

### Claude Desktop Prompt Matrix
| # | Prompt | Expected tool | Result | Evidence | Issue # | Notes |
|---|--------|---------------|--------|----------|---------|-------|
| 1 | What courses am I enrolled in? | `list_courses` | | | | |
| 2 | List sections and files for course <ID> | `get_course_content` | | | | |
| 3 | Open this section URL and summarize the text: <section URL> | `get_section_text` | | | | |
| 4 | Read this file: <fileUrl from content> | `get_file_text` | | | | |
| 5 | What’s due in the next two weeks? | `get_upcoming_deadlines` | | | | |
| 6 | What deadlines are in March 2026? | `get_deadlines` | | | | |
| 7 | Assignments due between <start> and <end> | `get_deadlines` | | | | |
| 8 | Get full details for this assignment URL <url> | `get_item_details` | | | | |
| 9 | What are my grades? | `get_grades` | | | | |
| 10 | Recent announcements | `get_announcements` | | | | |
| 11 | What are my upcoming exams? | `get_exam_schedule` | | | | |
| 12 | What is my class schedule? | `get_class_timetable` | | | | |
| 13 | Search RateMyProfessors for professor John Doe | `search_professors` | | | | |
| 14 | Get professor details for ID XXXXX | `get_professor_details` | | | | |
| S | Session expiry | `list_courses` or any eClass tool | | | | |

### Notes
- Use a cold cache for the first pass after the refactor.
- Prefer the same known-good course IDs used in earlier runs if they still exist.
- Record a failure issue for any row that changes shape, breaks import/export, or causes a tool regression.
