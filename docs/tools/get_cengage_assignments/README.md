# `get_cengage_assignments`

`get_cengage_assignments` is the lower-level Cengage/WebAssign assignment tool. For normal user assignment questions, prefer `get_assignments` so eClass and Cengage/WebAssign are resolved together through the permanent course-platform index.

## Features

- Fetches assignments from saved-session dashboard flow by default.
- Supports dashboard-first mode without `entryUrl` by using saved session state.
- Dashboard-first bootstrap uses deterministic canonical homes (Cengage dashboard variants, then WebAssign student-home variants).
- Supports bounded all-courses aggregation mode (`allCourses=true`) to return assignment summaries across multiple courses.
- Accepts explicit compatibility/fallback links (`entryUrl`, legacy `ssoUrl`) when dashboard inventory cannot directly resolve the target course.
- Tries explicit WebAssign course and eClass LTI launch URLs directly before falling back to dashboard course selection.
- Activates dashboard-selected courses through the dashboard card when possible, then verifies WebAssign's active course context before returning rows.
- Accepts registration-style entry links that redirect into WebAssign/Cengage, including `getenrolled.com` course-key URLs.
- Supports explicit selection via `courseId`, `courseKey`, or `courseQuery`.
- Returns normalized assignment rows with due/status/score fields.
- Returns `_cache` freshness metadata and typed retry guidance.

## Recommended Call Patterns

- Dashboard-first single course: omit `entryUrl` and provide `courseQuery`/`courseId`/`courseKey` as needed.
- Dashboard-first bounded aggregation: set `allCourses=true` (optionally `maxCourses`, `maxAssignmentsPerCourse`) to summarize multiple courses.
- Explicit fallback mode: provide `entryUrl` (or legacy `ssoUrl`) only when a specific launch path is required.
- Cross-platform path: call `get_assignments` with `courseId`, `courseCode`, or `courseQuery`; use `platformSelection.cengage` only when the resolver returns `needs_course_selection`.

## Compatibility and Migration

- Default mode: omit both `entryUrl` and `ssoUrl`; tool resolves from saved Cengage session.
- Preferred input for explicit-link fallback mode: `entryUrl`.
- Legacy alias: `ssoUrl` (still accepted for existing prompts/callers).
- When multiple courses are available, tool may return `needs_course_selection`; retry with explicit course selectors.
- When WebAssign opens the wrong active course, tool returns `needs_course_activation` with `code="COURSE_CONTEXT_MISMATCH"` and `retry.afterAuth=false`; do not treat this as no assignments or a normal auth retry.
- Aggregation mode: set `allCourses=true` and optionally provide `maxCourses` (default 5, max 10) and `maxAssignmentsPerCourse` (default 10, max 25).

## Enrollment-Link Guidance

- Enrollment/registration links are fallback inputs for cases where dashboard inventory has not exposed a course yet.
- Direct WebAssign/LTI links are activation hints, not proof of active context. The tool opens them directly for compatibility, but still validates WebAssign's current-course DOM before returning assignments.
- After explicit-link bootstrap succeeds, prefer dashboard selectors (`courseId`, `courseKey`, `courseQuery`) for deterministic retries.

## Course Activation Guard

WebAssign can produce a misleading state where the URL includes the requested `courseKey`, but the page DOM and title show a different active course. In the MATH 1014 regression, the launch URL contained the MATH course key while WebAssign's active context reported PHYS 1800. This tool now checks active context signals such as page title, `data-current-selected`, `data-courses`, current-course text, and course-menu links.

If the context does not match the selected Cengage course, the response is:

```json
{
  "status": "needs_course_activation",
  "code": "COURSE_CONTEXT_MISMATCH",
  "assignments": [],
  "retry": { "afterAuth": false, "reason": "course_activation_required" }
}
```

This means the mapping or course key may still be correct; the browser/WebAssign active course needs to be activated or repaired before assignment rows can be trusted.

## Known Problems

- Assignment table variants can change with platform UI updates.
- Some courses may expose sparse status text, resulting in `status="unknown"`.
- Empty assignment states can be valid and return `no_data`.
- WebAssign can land in a stale previous-course context; the tool refuses to return assignments when the selected course and active WebAssign context disagree.

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
- Course activation/context verification: `src/scraper/cengage/course-context.ts` and `CengageScraper.getAssignmentsForDashboardCourse`.
- Aggregation metadata: response includes `aggregation` and `allCourses` when `allCourses=true`.
- Cache key scope: `cengage/assignments` with `TTL.DEADLINES`.
