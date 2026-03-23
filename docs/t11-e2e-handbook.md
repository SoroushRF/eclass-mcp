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

What this handbook does not do:
- it does not replace CI
- it does not replace unit or fixture tests
---

### 1.1 Status & History
- **Run [1]:** Successfully executed on **2026-03-22**. 10/10 tools passed.
- **Run [2]:** Successfully executed on **2026-03-22** (SIS integration phase, pre-RMP). 12/12 tools passed.
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

| # | Prompt | Expected tool | Pass criteria |
|---|--------|---------------|---------------|
| 1 | What courses am I enrolled in? | `list_courses` | Non-empty JSON array; each item has `id`, `name`, `url` |
| 2 | List sections and files for course <ID> | `get_course_content` | Response has a `sections` array; each item has `type`, `name`, `url` |
| 3 | Open this section URL and summarize the text: <section URL> | `get_section_text` | Has `title` and at least one of `mainText` or `tabs` populated |
| 4 | Read this file: <fileUrl from content> | `get_file_text` | Returns content blocks; text blocks are non-empty; no error payload |
| 5 | What’s due in the next two weeks? | `get_upcoming_deadlines` | Non-empty array; each item has `dueDate` and `url` |
| 6 | What deadlines are in March 2026? | `get_deadlines` | Non-empty array; dates fall within the requested month |
| 7 | Assignments due between <start> and <end> | `get_deadlines` | Non-empty array; dates fall within the requested range |
| 8 | Get full details for this assignment URL <url> | `get_item_details` | Has `kind` and at least one of `instructions` or `fields` |
| 9 | What are my grades? | `get_grades` | Rows include item names and grade values |
| 10 | Recent announcements | `get_announcements` | Non-empty array; each entry has `title`, `date`, and `body` |
| 11 | What are my upcoming exams? | `get_exam_schedule` | List of exams with codes, dates, and times |
| 12 | What is my class schedule? | `get_class_timetable` | List of LECT/LAB/TUTR entries for the session |
| 13 | Search RateMyProfessors for professor John Doe | `search_professors` | List of professor profiles matching the name |
| 14 | Get professor details for ID XXXXX | `get_professor_details` | Detailed ratings and comments for a specific ID |

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

## 11. Notes For Reviewers

This is intentionally a manual host-validation step.
Do not replace it with unit tests or fixture tests.
Use CI and fixtures to support it, not to substitute for it.
