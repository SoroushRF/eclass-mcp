# `get_deadlines`

`get_deadlines` is eClass-only. For user-facing assignment/homework/deadline questions where Cengage/WebAssign may matter, prefer `get_assignments`.

## Features

- Unified deadlines query tool with scopes:
  - `upcoming`
  - `month` (`month`, `year`)
  - `range` (`from`, `to`)
- Optional detail expansion: `includeDetails`, `maxDetails`.
- Returns typed list with inferred `type` (`assign`/`quiz`/`other`).
- Empty course-specific eClass results include `recommendedTool: "get_assignments"` so clients do not treat "no eClass deadlines" as final.

## Known Problems

- Date parsing relies on Moodle date string consistency.
- Month/range quality depends on assignment-index coverage in source pages.
- This tool does not inspect Cengage/WebAssign. Empty `items` can still mean assignments exist externally.

## Tests

- Prompts:
  - "What deadlines are in March 2026?"
  - "Assignments due between 2026-03-01 and 2026-03-31."
- Script: `npx ts-node scripts/test-month-view.ts`.
- Investigation log (archived): `docs/archive/tools/deadlines/failed-prompts-investigation-plan.md`.

## Edge Cases

- `scope=range` with invalid dates.
- Deadlines with missing/ambiguous date strings.
- Duplicate items across scrape paths.

## Technical Notes

- Source: `src/tools/deadlines.ts` (`getDeadlines()`).
- Uses `scraper.getAllAssignmentDeadlines(courseId)` for month/range.
- Cache key format: `deadlines_v3_<scope>_<course|all>_<extra>`.
- TTL: `TTL.DEADLINES`.
