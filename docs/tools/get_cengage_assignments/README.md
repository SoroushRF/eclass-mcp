# `get_cengage_assignments`

## Features
- Fetches assignments from Cengage/WebAssign dashboard and direct-course flows.
- Supports explicit selection via `courseId`, `courseKey`, or `courseQuery`.
- Returns normalized assignment rows with due/status/score fields.
- Preserves compatibility with legacy input (`ssoUrl`) while preferring `entryUrl`.
- Returns `_cache` freshness metadata and typed retry guidance.

## Compatibility and Migration
- Preferred input: `entryUrl`.
- Legacy alias: `ssoUrl` (still accepted for existing prompts/callers).
- When multiple courses are available, tool may return `needs_course_selection`; retry with explicit course selectors.

## Known Problems
- Assignment table variants can change with platform UI updates.
- Some courses may expose sparse status text, resulting in `status="unknown"`.
- Empty assignment states can be valid and return `no_data`.

## Tests
- `tests/cengage-assignments-tool.test.ts`
- `tests/cengage-e2e-scenarios.test.ts`
- `tests/cengage-fixtures.test.ts`

## Edge Cases
- Ambiguous selection on dashboard entry URLs.
- Auth-expired state during navigation (`auth_required` + retry guidance).
- Direct course link that resolves to a dashboard with multiple courses.

## Technical Notes
- Source: `src/tools/cengage.ts` (`getCengageAssignments`).
- Schemas: `src/tools/cengage-contracts.ts` (`GetCengageAssignmentsInputSchema`, `GetCengageAssignmentsResponseSchema`).
- Selection logic: `src/scraper/cengage-courses.ts` (`resolveDashboardCourseSelection`).
- Cache key scope: `cengage/assignments` with `TTL.DEADLINES`.
