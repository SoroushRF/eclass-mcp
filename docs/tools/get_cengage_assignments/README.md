# `get_cengage_assignments`

## Features
- Fetches assignments from saved-session dashboard flow by default.
- Supports dashboard-first mode without `entryUrl` by using saved session state.
- Dashboard-first bootstrap uses deterministic canonical homes (Cengage dashboard variants, then WebAssign student-home variants).
- Supports bounded all-courses aggregation mode (`allCourses=true`) to return assignment summaries across multiple courses.
- Accepts explicit compatibility/fallback links (`entryUrl`, legacy `ssoUrl`) when dashboard inventory cannot directly resolve the target course.
- Accepts registration-style entry links that redirect into WebAssign/Cengage, including `getenrolled.com` course-key URLs.
- Supports explicit selection via `courseId`, `courseKey`, or `courseQuery`.
- Returns normalized assignment rows with due/status/score fields.
- Returns `_cache` freshness metadata and typed retry guidance.

## Recommended Call Patterns
- Dashboard-first single course: omit `entryUrl` and provide `courseQuery`/`courseId`/`courseKey` as needed.
- Dashboard-first bounded aggregation: set `allCourses=true` (optionally `maxCourses`, `maxAssignmentsPerCourse`) to summarize multiple courses.
- Explicit fallback mode: provide `entryUrl` (or legacy `ssoUrl`) only when a specific launch path is required.

## Compatibility and Migration
- Default mode: omit both `entryUrl` and `ssoUrl`; tool resolves from saved Cengage session.
- Preferred input for explicit-link fallback mode: `entryUrl`.
- Legacy alias: `ssoUrl` (still accepted for existing prompts/callers).
- When multiple courses are available, tool may return `needs_course_selection`; retry with explicit course selectors.
- Aggregation mode: set `allCourses=true` and optionally provide `maxCourses` (default 5, max 10) and `maxAssignmentsPerCourse` (default 10, max 25).

## Enrollment-Link Guidance
- Enrollment/registration links are fallback inputs for cases where dashboard inventory has not exposed a course yet.
- After explicit-link bootstrap succeeds, prefer dashboard selectors (`courseId`, `courseKey`, `courseQuery`) for deterministic retries.

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
- Dashboard-first calls with multiple courses and no selectors can return `needs_course_selection`.
- All-courses aggregation can return partial warnings when one or more courses fail assignment fetch.
- All-courses aggregation truncates per-course results when limits are exceeded and returns truncation metadata.
- Auth-expired state during navigation (`auth_required` + retry guidance).
- Direct course link that resolves to a dashboard with multiple courses.

## Technical Notes
- Source: `src/tools/cengage.ts` (`getCengageAssignments`).
- Schemas: `src/tools/cengage-contracts.ts` (`GetCengageAssignmentsInputSchema`, `GetCengageAssignmentsResponseSchema`).
- Selection logic: `src/scraper/cengage-courses.ts` (`resolveDashboardCourseSelection`).
- Aggregation metadata: response includes `aggregation` and `allCourses` when `allCourses=true`.
- Cache key scope: `cengage/assignments` with `TTL.DEADLINES`.
