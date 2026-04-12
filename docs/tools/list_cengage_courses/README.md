# `list_cengage_courses`

## Features
- Lists Cengage/WebAssign courses from saved-session dashboard inventory by default.
- Supports dashboard-first mode without `entryUrl` by bootstrapping from saved Cengage session state.
- Dashboard-first bootstrap uses deterministic canonical homes (Cengage dashboard variants, then WebAssign student-home variants).
- Supports compatibility/fallback inputs (`entryUrl`, `discoveredLink`) when an explicit launch path is required.
- Supports optional pre-filtering via `courseQuery`.
- Returns deterministic status values (`ok`, `needs_course_selection`, `no_data`, `auth_required`, `error`).
- Returns retry guidance when authentication is required.

## Recommended Call Patterns
- Default dashboard-first inventory: call with no `entryUrl`.
- Dashboard-first pre-filter: provide `courseQuery` when narrowing to a known course title.
- Explicit fallback mode: provide `entryUrl` (or a `discoveredLink`) only when dashboard inventory does not surface the intended course.

## Known Problems
- Course card structure may vary by Cengage UI variants.
- Ambiguous `courseQuery` inputs can return multiple candidates.
- Requires a valid Cengage session state.

## Tests
- `tests/cengage-list-courses.test.ts`
- `tests/cengage-e2e-scenarios.test.ts`
- `tests/cengage-fixtures.test.ts`

## Edge Cases
- Empty dashboards (returns `no_data`).
- Calls without `entryUrl` still run in dashboard-first mode; stale/missing session returns `auth_required`.
- Ambiguous query selection (returns `needs_course_selection`).
- Session missing or stale (returns `auth_required` with `retry.authUrl`).

## Technical Notes
- Source: `src/tools/cengage.ts` (`listCengageCourses`).
- Schemas: `src/tools/cengage-contracts.ts` (`ListCengageCoursesInputSchema`, `ListCengageCoursesResponseSchema`).
- Auth helper: `src/auth/server.ts` (`getAuthUrl('cengage')`, `openAuthWindow('cengage')`).
- Cache key scope: `cengage/list_courses` with `TTL.CONTENT`.
