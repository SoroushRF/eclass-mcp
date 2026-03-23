# Deadlines Feature - Failed Prompts Investigation Plan

## Purpose
Track failed or partially failed prompts for the deadlines/details feature and investigate them one-by-one in a strict sequence.

We will only move to the next prompt after:
1) root cause is identified,
2) fix is implemented,
3) fix is verified,
4) docs are updated.

---

## Failed Prompt Backlog

## P1 - Month scope returned empty
**Prompt**
`Show my eClass deadlines for March 2026 (include past and future). Return the list.`

**Observed result**
- Returned empty for month scope.
- Range fallback also returned empty.
- Assistant inferred "eClass is upcoming-only."

**Expected result**
- `scope=month` should return assignment items from March 2026 (including past+future).

**Root cause (confirmed)**
- Month calendar grid was an unreliable source in this tenant/theme.
- DOM extraction/filtering from calendar view did not reliably expose assignment links/data.
- Empty month results were also reinforced by cached empty arrays during investigation.

**Fix applied**
1. Pivoted month/range source from calendar month view to assignment index pages.
2. Implemented aggregation from `mod/assign/index.php?id=<courseId>`.
3. Filtered by parsed due date for the requested month.
4. Treated cached empty arrays as cache miss during recomputation.

**Acceptance criteria**
- Month query returns non-empty when events exist in that month.
- Returned items include `name`, `dueDate`, `url`, `courseId`, `type`.

**Verification**
- Prompt re-run by user succeeded after architecture pivot.
- Status: **Done**

---

## P2 - Range scope returned empty for historical window
**Prompt**
`Show all eClass deadlines between 2026-01-01 and 2026-01-31.`

**Observed result**
- Empty result.
- Assistant inferred "API is forward-only."

**Expected result**
- Range should return historical assignments when present in assignment index tables.

**Root cause (confirmed)**
- Range logic depended on the same unreliable month calendar source.
- Boundaries and filtering were not aligned to full-day behavior for `YYYY-MM-DD`.

**Fix applied**
1. Reused assignment-index aggregation for range queries.
2. Added explicit boundary normalization for day-only inputs:
   - `from` -> start of day
   - `to` -> end of day
3. Filtered only on parseable due dates from assignment index rows.

**Acceptance criteria**
- Range query returns historical events when present in source pages.
- If no source data exists, response includes a clear "no source events found" explanation path (to be designed).

**Verification**
- Prompt re-run by user succeeded for January range.
- Status: **Done**

---

## P3 - Quiz details missing grade
**Prompt**
`Open this eClass item and extract the full description/instructions plus my submission status and grade/feedback if shown: https://eclass.yorku.ca/mod/quiz/view.php?id=3859421`

**Observed result**
- Details fetched successfully.
- Grade was missing even though quiz was graded.

**Expected result**
- Quiz details include grade (or score) when visible on the quiz page.

**Root cause (resolved)**
- Quiz grade selector coverage was too narrow.
- Grade appeared in a block outside the current summary table selectors.

**Fix applied**
1. Expanded quiz parser selectors for grade/score labels and summary blocks.
2. Added fallback handling for review/attempt summary blocks when present.
3. Kept ungraded quizzes stable so the parser does not invent grades.

**Verification**
- `get_item_details` now returns `grade` for graded quiz pages when the grade is visible in the UI.
- No regression for ungraded quizzes was observed in the verified run.
- Status: **Done**

---

## P4 - Assignment descriptions missing (text + images)
**Prompt**
`Get my upcoming deadlines and for the first 5 items also fetch the full instructions/description and my status/grade if available.`

**Observed result**
- Returned "template only" for multiple assignment descriptions.
- User confirms real descriptions exist with mixed text + images.

**Expected result**
- Assignment details should include meaningful instruction content from assignment intro/description area.
- Preserve both text and image references where possible.

**Root cause (resolved)**
- Description selector was grabbing wrapper boilerplate instead of authored content.
- Lazy-loaded and nested content were not being captured consistently.

**Fix applied**
1. Targeted the authored content container instead of the template wrapper.
2. Extracted richer payloads with cleaned text, HTML fragments, and resolved image URLs.
3. Kept the `get_item_details` and `get_deadlines(includeDetails=true)` shapes compatible with Claude Desktop.

**Verification**
- Assignment details now include meaningful instructions rather than only boilerplate.
- Image references are preserved when present.
- Status: **Done**

---

## P5 - Deadline summaries used raw eClass course IDs instead of readable course labels
**Prompt**
`check my eclass what should I study for tonight?`

**Observed result**
- Deadline prioritization was broadly correct.
- Some items were labeled like `Course 149363` instead of the human-facing course name or course code students recognize.

**Expected result**
- Deadline items should carry a readable course label so assistants can say `EECS1021` or the actual course title, not the raw eClass ID.

**Root cause (confirmed)**
- Deadline items returned `courseId` but not `courseName` or `courseCode`.
- Claude had to infer a display label from incomplete data and sometimes fell back to the numeric eClass course ID.

**Fix applied**
1. Extended `DeadlineItem` to include `courseName?` and `courseCode?`.
2. Enriched upcoming-calendar deadlines with course metadata from the linked course card text.
3. Enriched assignment-index deadlines by joining course IDs against `getCourses()` results.
4. Bumped deadline cache keys so old `courseId`-only payloads would be bypassed automatically.

**Acceptance criteria**
- Deadline payloads include readable course metadata when available.
- Claude can summarize deadlines using `courseCode` or `courseName` without inventing labels like `Course 149363`.

**Verification**
- TypeScript compile check passed after the payload change.
- Status: **Done**

---

## Execution Procedure (Strict Order)
1. Investigate/fix **P1**.
2. Investigate/fix **P2**.
3. Investigate/fix **P3**.
4. Investigate/fix **P4**.
5. Investigate/fix **P5**.

For each prompt:
1. Reproduce.
2. Capture evidence (HTML/selectors/output).
3. Implement minimal fix.
4. Run script tests + MCP prompt test.
5. Update docs (`history.md`, this file, `docs/PROJECT_MASTER.md` if cross-cutting) with outcome.

---

## Documentation Update Checklist Per Prompt
- [ ] Mark prompt status: `Open -> In Progress -> Verified -> Done`
- [ ] Add root cause summary
- [ ] Add changed files list
- [ ] Add verification commands + observed output summary
- [ ] Add follow-up risks

---

## Status Board
- P1: Done
- P2: Done
- P3: Done
- P4: Done
- P5: Done
