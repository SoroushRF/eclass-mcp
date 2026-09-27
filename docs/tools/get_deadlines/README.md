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

## Data source

1. **Session AJAX** calendar functions (primary in `api` and `shadow` modes).
2. **Token REST** `core_calendar_get_action_events_by_timesort`, only when the AJAX read fails; results are filtered to `courseId` when one is given. A rate limit is never retried over REST.
3. **Playwright** calendar pages (fallback and default mode).

Mode is `ECLASS_API_SOURCE_MODE`: `playwright` (default) never calls REST; `shadow` runs both paths, returns Playwright data, and logs only mismatch categories; `api` returns the API result with one bounded Playwright fallback. REST is skipped (not failed) when no mobile credential is stored; a rejected token re-mints once through the cookie session (ADR 0011).

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
- Cache keys use the shared cache schema helper: `getCacheKey("deadlines", scope, courseId || "all", extra)`, stored as versioned `v1_deadlines_*.json` filenames.
- TTL: `TTL.DEADLINES`.
- Empty eClass result arrays are cached briefly so legitimate "nothing due here" states do not cause repeated scrapes.
