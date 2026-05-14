# T11 E2E Handbook

This is the operator handbook for **T11 - Formal E2E testing (Claude Desktop)**.

Use this file when you are running the manual end-to-end verification. The tracker in `PROJECT_MASTER.md` stays intentionally short; this handbook is the authoritative procedure.

## 1. Purpose

T11 proves the real MCP server works through the real host, Claude Desktop, with evidence that can be used after releases or regressions.

What this handbook covers:

- prerequisites and environment capture
- the exact prompt matrix
- **Phase A.1: Inspector Smoke Pass (Server-only)**
- pass/fail/skip rules
- session-expiry regression
- how to record evidence and file failures

Inspector launch command for server-only smoke testing:

```powershell
npx.cmd @modelcontextprotocol/inspector node dist/index.js
```

What this handbook does not do:

- it does not replace CI
- it does not replace unit or fixture tests

---

### 1.1 Status & History

- **Run [1]:** Successfully executed on **2026-03-22**. 10/10 tools passed.
- **Run [2]:** Successfully executed on **2026-03-22** (SIS integration phase, pre-RMP). 12/12 tools passed.
- **T20 completion:** Verified in stages across Inspector and Claude Desktop; SIS tools were already validated, and RMP professor search/details were verified on **2026-03-23**.
- **Environment:** Node v24.11.0, repo `c885853`.
- **Result:** SIS integration verified in Inspector and Claude Desktop.

---

## 2. Preconditions

All of these must be true before you start the run:

1. Record environment metadata.
2. Confirm `npm.cmd run build` succeeds if you are using PowerShell on Windows.
3. Confirm `npx.cmd tsc --noEmit` is clean if you are using PowerShell on Windows.
4. Confirm `npx.cmd playwright install chromium` has already been done on the machine.
5. Confirm Claude Desktop points the `eclass` server at `dist/index.js` or a documented equivalent using an absolute path.
6. Confirm auth is valid by checking `GET http://localhost:<AUTH_PORT>/status` after visiting `/auth` and logging in.
7. Optionally clear `.eclass-mcp/cache/*` if you want a cold-cache run.

If any precondition fails, stop and fix it before running the matrix.

## 2.1 Before You Start

Quick sanity check before opening Claude Desktop:

- [ ] I know which commit I am testing.
- [ ] `npm.cmd run build` is green in PowerShell, or the equivalent shell-safe build command is green.
- [ ] `npx.cmd tsc --noEmit` is green in PowerShell, or the equivalent shell-safe TypeScript check is green.
- [ ] Chromium is installed for Playwright.
- [ ] Claude Desktop is pointed at `dist/index.js` or the documented equivalent.
- [ ] Auth is valid or I know how to re-auth.
- [ ] I have a fresh section ready in `docs/e2e-run-log.md`.

## 3. Run Log

Record the run in [`docs/e2e-run-log.md`](./e2e-run-log.md).

Use one section per run and capture:

- date
- OS
- Node version
- Claude Desktop version
- repo commit
- cache state
- session state

The log is part of the definition of done. If it is not filled in, the run is not complete.

## 4. How To Run

1. Start with a cold cache for the first run on a new commit.
2. Open Claude Desktop and confirm the `eclass` tools are visible in the tools UI.
3. Run the prompts in the order shown below.
4. For each row, record the exact prompt used.
5. Record which tool Claude actually invoked.
6. Record a short evidence snippet from the response, redacting any personal data.
7. Mark the row Pass, Fail, or Skip.
8. File a GitHub issue immediately for any Fail and record the issue number in the log.
9. Run the session-expiry regression last.

Warm-cache reruns are allowed for regression checks, but the first pass for a new commit should be cold-cache whenever practical.

## 5. Prompt Matrix

Use these prompts as written unless the local data forces a small adjustment.

| #   | Prompt                                                      | Expected tool            | Pass criteria                                                        |
| --- | ----------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| 1   | What courses am I enrolled in?                              | `list_courses`           | Non-empty JSON array; each item has `id`, `name`, `url`              |
| 2   | List sections and files for course <ID>                     | `get_course_content`     | Response has a `sections` array; each item has `type`, `name`, `url` |
| 3   | Open this section URL and summarize the text: <section URL> | `get_section_text`       | Has `title` and at least one of `mainText` or `tabs` populated       |
| 4   | Read this file: <fileUrl from content>                      | `get_file_text`          | Returns content blocks; text blocks are non-empty; no error payload  |
| 5   | What’s due in the next two weeks?                           | `get_upcoming_deadlines` | Non-empty array; each item has `dueDate` and `url`                   |
| 6   | What deadlines are in March 2026?                           | `get_deadlines`          | Non-empty array; dates fall within the requested month               |
| 7   | Assignments due between <start> and <end>                   | `get_deadlines`          | Non-empty array; dates fall within the requested range               |
| 8   | Get full details for this assignment URL <url>              | `get_item_details`       | Has `kind` and at least one of `instructions` or `fields`            |
| 9   | What are my grades?                                         | `get_grades`             | Rows include item names and grade values                             |
| 10  | Recent announcements                                        | `get_announcements`      | Non-empty array; each entry has `title`, `date`, and `body`          |
| 11  | What are my upcoming exams?                                 | `get_exam_schedule`      | List of exams with codes, dates, and times                           |
| 12  | What is my class schedule?                                  | `get_class_timetable`    | List of LECT/LAB/TUTR entries for the session                        |
| 13  | Search RateMyProfessors for professor John Doe              | `search_professors`      | List of professor profiles matching the name                         |
| 14  | Get professor details for ID XXXXX                          | `get_professor_details`  | Detailed ratings and comments for a specific ID                      |

## 6. Session Expiry Regression

Run this after the full matrix:

1. Stop the MCP server if needed.
2. Delete `.eclass-mcp/session.json` or replace it with an invalid session file.
3. Restart the server.
4. Invoke any eClass tool from Claude Desktop.
5. Confirm the user gets a visible re-authentication path.
6. Re-authenticate.
7. Run one smoke tool, such as `list_courses`.

This passes if the server recovers cleanly and the smoke tool returns data.

## 7. Evidence Rules

For every non-Skip row, record one of these:

- a short raw JSON snippet
- or an explicit note that no JSON was visible

Redact:

- names
- student IDs
- grades
- anything else personally identifying

If the tool returned an error instead of normal data, include the error shape briefly and mark the row Fail.

## 8. Pass / Fail / Skip Rules

Pass:

- the correct tool was invoked
- the response shape matched the pass criteria

Fail:

- the wrong tool was invoked
- the tool errored
- the response did not satisfy the pass criteria

Skip:

- the course data does not contain an appropriate artifact to test
- the prompt cannot be answered for a legitimate data reason
- document the exact reason in the log

## 9. Failure Handling

If a row fails:

1. Open an issue right away.
2. Include the tool name, prompt, and a redacted evidence snippet.
3. Add the issue number to the run log.
4. Keep the log entry short and factual.

If multiple rows fail for the same root cause, still record each row separately and link them to the same issue if appropriate.

## 9.1 Failure Issue Template

Use this when opening a GitHub issue for a failed row:

```md
Title: T11 E2E failure - <tool name> - <short symptom>

## Context

- Commit:
- Date:
- Claude Desktop version:
- OS:

## Prompt

<paste the exact prompt>

## Expected

<briefly describe the expected tool and response shape>

## Observed

<paste a redacted evidence snippet or "no JSON visible">

## Notes

- Issue log row:
- Related rows:
- Suspected cause:
```

## 10. Completion Checklist

T11 is complete when all of the following are true:

- the run log exists and is filled in
- all 14 matrix rows are marked Pass, Fail, or Skip
- the session-expiry row is recorded
- every non-Skip row has evidence
- every Fail has an issue number
- `npx tsc --noEmit` was clean for the tested commit

T20 is complete as of **2026-03-23** after SIS and RMP verification finished.

## 11. Notes For Reviewers

This is intentionally a manual host-validation step.
Do not replace it with unit tests or fixture tests.
Use CI and fixtures to support it, not to substitute for it.

## 12. T25 Refactor Regression

Use this section after the eClass scraper modularization refactor lands.

### 12.1 What Changed

- `src/scraper/eclass.ts` became a thin barrel.
- The scraper logic moved into `src/scraper/eclass/`.
- Browser/session ownership is now isolated from feature modules.
- The public tool surface should remain unchanged.

### 12.2 T25 Sub-Tasks

- Baseline inventory: map every method/helper/type in the old monolith.
- Shared helpers: extract metadata and item-type helpers first.
- Browser/session: move Playwright context and debug dump ownership out.
- Feature slices: split courses, deadlines, item details, grades, announcements, files, and sections.
- Barrel cleanup: preserve `scraper` and type exports with no call-site churn.
- Regression E2E: prove the engine still works after the split.

### 12.3 How To Run

1. Confirm the refactor commit is built:
   - `npm.cmd run build`
   - `npx.cmd tsc --noEmit`
2. Start the MCP Inspector against the built server:
   ```powershell
   npx.cmd @modelcontextprotocol/inspector node dist/index.js
   ```
3. Open `http://localhost:6274` and run the server-only smoke rows below.
4. Open Claude Desktop and run the prompt matrix in the next table.
5. Record results in [`docs/e2e-run-log.md`](./e2e-run-log.md).
6. If any row fails, file an issue immediately and link it in the log.

### 12.4 Inspector Smoke Pass

Use the Inspector for a quick server-level regression before Claude Desktop.

| #       | Tool                    | Pass criteria                                        |
| ------- | ----------------------- | ---------------------------------------------------- |
| T25-I1  | `list_courses`          | Same course count/shape as before the refactor       |
| T25-I2  | `get_course_content`    | Returns sections and items with unchanged item types |
| T25-I3  | `get_deadlines`         | Returns deadlines with the same course/date shape    |
| T25-I4  | `get_item_details`      | Returns assignment/quiz details with the same fields |
| T25-I5  | `get_grades`            | Returns the same grade rows as before                |
| T25-I6  | `get_announcements`     | Returns announcement rows with title/date/content    |
| T25-I7  | `get_exam_schedule`     | SIS still resolves and parses current exams          |
| T25-I8  | `get_class_timetable`   | SIS still resolves and parses timetable rows         |
| T25-I9  | `search_professors`     | RMP search still returns profile matches             |
| T25-I10 | `get_professor_details` | RMP detail fetch still returns ratings/comments      |

### 12.5 Claude Desktop Prompt Matrix

Use a course that has sections, files, assignments, grades, and announcements when possible. Reuse the same known good course IDs from prior runs if they still exist.

| #   | Prompt                                                      | Expected tool            | Pass criteria                                                                |
| --- | ----------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| 1   | What courses am I enrolled in?                              | `list_courses`           | Non-empty array with stable `id`, `name`, `url` fields                       |
| 2   | List sections and files for course <ID>                     | `get_course_content`     | Sections/items still appear correctly after the refactor                     |
| 3   | Open this section URL and summarize the text: <section URL> | `get_section_text`       | Main text and tabbed content still extract correctly                         |
| 4   | Read this file: <fileUrl from content>                      | `get_file_text`          | File content still returns text/images with no shape drift                   |
| 5   | What’s due in the next two weeks?                           | `get_upcoming_deadlines` | Deadline list still contains course/date metadata                            |
| 6   | What deadlines are in March 2026?                           | `get_deadlines`          | Month filter still works and returns only requested-month items              |
| 7   | Assignments due between <start> and <end>                   | `get_deadlines`          | Range filter still works, including past/future ranges                       |
| 8   | Get full details for this assignment URL <url>              | `get_item_details`       | Assignment/quiz details still include instructions, status, and grade fields |
| 9   | What are my grades?                                         | `get_grades`             | Grade rows still parse correctly after module split                          |
| 10  | Recent announcements                                        | `get_announcements`      | Announcement list still contains title/date/body                             |
| 11  | What are my upcoming exams?                                 | `get_exam_schedule`      | SIS exam schedule still resolves and parses correctly                        |
| 12  | What is my class schedule?                                  | `get_class_timetable`    | SIS timetable still resolves and parses correctly                            |
| 13  | Search RateMyProfessors for professor John Doe              | `search_professors`      | RMP search still returns matching profiles                                   |
| 14  | Get professor details for ID XXXXX                          | `get_professor_details`  | RMP detail fetch still returns ratings and comments                          |

### 12.6 Evidence Rules

- Capture a short JSON snippet or a clear note that no JSON was visible.
- Redact names, student IDs, grades, and anything else personally identifying.
- Mark any failure with an issue number before you move on.

### 12.7 Completion Criteria

- All T25 smoke rows pass or are explained as legitimate skips.
- The refactor did not change tool contracts.
- `npx tsc --noEmit` and `npm run build` stay green on the tested commit.

## 13. T23 Cengage Scenario Coverage

Use this section for T23 validation of Cengage-specific flows.

### 13.1 Goal

- Cover direct dashboard link flow.
- Cover direct course link flow.
- Cover auth-expired recovery flow with machine-usable retry output.

### 13.2 Inspector Scenario Rows

Run these rows in MCP Inspector against `dist/index.js`.

| #      | Tool                                                            | Input shape                                                              | Pass criteria                                                                                  |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| C23-I1 | `list_cengage_courses`                                          | `{ entryUrl: "https://www.cengage.com/dashboard/home" }`                 | `status` is `ok` or `needs_course_selection`; `courses` array present                          |
| C23-I2 | `get_cengage_assignments`                                       | `{ entryUrl: "https://www.webassign.net/v4cgi/login.pl?courseKey=..." }` | `status` is `ok` or `no_data`; response includes `selectedCourse` when resolved                |
| C23-I3 | `list_cengage_courses` after invalidating Cengage session files | `{ entryUrl: "https://www.cengage.com/dashboard/home" }`                 | `status` is `auth_required`; `retry.afterAuth=true`; `retry.authUrl` points to `/auth-cengage` |

### 13.3 Claude Desktop Prompt Rows

Use these prompts for host-level verification.

| #      | Prompt                                                                | Expected tool             | Pass criteria                                                               |
| ------ | --------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| C23-C1 | List my Cengage courses from this dashboard URL: <dashboard URL>      | `list_cengage_courses`    | Claude returns course candidates or an explicit selection-needed response   |
| C23-C2 | Get Cengage assignments from this direct course URL: <course URL>     | `get_cengage_assignments` | Claude returns assignments or explicit no-data with selected course context |
| C23-C3 | I just expired my Cengage session. Try listing Cengage courses again. | `list_cengage_courses`    | Claude receives `auth_required`, guides login, then succeeds on retry       |

### 13.4 Auth-Expired Setup (Cengage)

To force auth-expired behavior before C23-I3/C23-C3:

1. Stop server processes that might hold the session.
2. Remove or rename:
   - `.eclass-mcp/cengage-state.json`
   - `.eclass-mcp/cengage-session-meta.json`
3. Restart the MCP server.
4. Run C23-I3 or C23-C3.

### 13.5 Recording Rules

- Record each C23 row in `docs/e2e-run-log.md` as Pass/Fail/Skip.
- Include a short redacted snippet for `status`, `message`, and `retry` fields.
- For auth-expired, include evidence that `/auth-cengage` was surfaced.
