# `get_deadlines`

## Features
- Unified deadlines query tool with scopes:
  - `upcoming`
  - `month` (`month`, `year`)
  - `range` (`from`, `to`)
- Optional detail expansion: `includeDetails`, `maxDetails`.
- Returns typed list with inferred `type` (`assign`/`quiz`/`other`).

## Known Problems
- Date parsing relies on Moodle date string consistency.
- Month/range quality depends on assignment-index coverage in source pages.

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
