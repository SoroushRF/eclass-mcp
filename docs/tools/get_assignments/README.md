# `get_assignments`

## Purpose

`get_assignments` is the canonical assignment/homework/deadline resolver. Use it for user-facing questions like "what assignments do I have?", "what is due this week?", or "show MATH 1014 homework" because it checks both eClass and Cengage/WebAssign when needed.

Lower-level tools remain available:

- `get_deadlines` and `get_upcoming_deadlines` are eClass-only.
- `get_cengage_assignments` is Cengage/WebAssign-only.
- `get_assignments` owns the cross-platform decision tree and should be the default path.

## Input

Important selectors:

- `courseId`: exact eClass course id when known.
- `courseCode`: compact or spaced course code, such as `MATH1014` or `MATH 1014`.
- `courseQuery`: fuzzy eClass course name/title query.
- `scope`: `upcoming`, `month`, or `range`.
- `month` / `year`: required for `scope="month"`.
- `from` / `to`: required for `scope="range"`.
- `includeExternal`: `auto` by default; use `always` to force Cengage/WebAssign, or `never` for eClass-only.
- `refreshPlatformIndex`: ignore the saved course-platform mapping and rematch.
- `platformSelection.cengage`: explicit Cengage `courseId`, `courseKey`, or `courseQuery` when a previous response returned `needs_course_selection`.

## Decision Tree

1. Resolve the eClass course from `courseId`, `courseCode`, or `courseQuery`.
2. Fetch eClass deadline rows through the shared typed deadline service.
3. Load `.eclass-mcp/course-platform-index.json`.
4. Decide whether Cengage/WebAssign must be checked:
   - `includeExternal="always"` forces the Cengage path.
   - `includeExternal="never"` skips Cengage and returns eClass-only results.
   - A linked index record always triggers Cengage.
   - Empty eClass results trigger Cengage so the tool does not report "no assignments" too early.
   - If Cengage auth is already valid, the resolver may opportunistically check and update the index.
5. If Cengage auth is missing and Cengage is required, open `/auth-cengage`, wait once for the saved session, then retry once.
6. Match eClass course identity to Cengage dashboard inventory.
7. Activate the selected WebAssign course and verify the active course context before parsing rows.
8. Return combined normalized assignments, or return an explicit action status.

## Response Statuses

- `ok`: all required sources checked successfully.
- `partial`: one source succeeded but another required source needs auth or failed.
- `needs_external_auth`: Cengage/WebAssign must be checked, but login did not complete within the wait window.
- `needs_course_selection`: multiple Cengage/WebAssign candidates matched; retry with `platformSelection.cengage`.
- `needs_course_activation`: Cengage/WebAssign mapping is known, but WebAssign opened a different active course. Do not report "no assignments"; activate the intended course and retry.
- `no_data`: all required/known sources were checked and no assignments were found.
- `error`: validation, selection, or unexpected tool failure.

## Course Platform Index

The resolver stores durable course mappings in `.eclass-mcp/course-platform-index.json`. This is permanent user state, not normal TTL cache:

- `clear_cache` does not delete it.
- Cengage re-auth clears volatile Cengage dashboard caches but keeps the index.
- Explicit `platformSelection.cengage` updates the mapping.
- A later not-found result marks the mapping stale/not-found instead of silently deleting it.
- A course-context mismatch keeps the mapping `linked` and writes `activation.status="failed"` diagnostics, because the dashboard course identity can still be correct even when WebAssign activates the wrong current course.

## Matching Rules

The matcher normalizes compact and spaced course codes. For example, `MATH1014` can match a Cengage title like `MATH 1014 O`.

Selection behavior:

- Explicit `courseId` or `courseKey` wins and persists as user selection.
- A single exact compact course-code match auto-links with high confidence.
- Multiple exact matches return `needs_course_selection`; section suffixes are not guessed.
- Fuzzy title matching only auto-selects when confidence is high and the margin over the second candidate is large.
- No match returns `no_data` only after required Cengage inventory was checked.

## Auth Behavior

When Cengage/WebAssign is required and the saved session is missing or stale, the resolver opens `/auth-cengage`, waits up to `ECLASS_MCP_CENGAGE_AUTH_WAIT_MS`, then retries once. If that variable is absent, it falls back to `ECLASS_MCP_AUTH_WAIT_MS` and then the default two-minute wait.

## Course Context Guard

WebAssign can sometimes keep a browser session pinned to a previous course even when a launch URL contains another `courseKey`. The resolver refuses to return rows when the selected course and the active WebAssign context disagree, such as selected `MATH 1014 O` but active page title/current-course data saying `PHYS 1800`.

In that case the resolver returns `status="needs_course_activation"` with `code="COURSE_CONTEXT_MISMATCH"`, `retry.afterAuth=false`, and diagnostics such as the actual course title or `data-current-selected` value. This is not final no-data and not an eClass-only answer. Activate the intended course from the Cengage/WebAssign UI, then retry `get_assignments` with the same input.

## Examples

```json
{ "courseCode": "MATH1014", "scope": "upcoming" }
```

```json
{ "courseQuery": "MATH 1014", "includeExternal": "always" }
```

```json
{
  "courseCode": "MATH1014",
  "platformSelection": {
    "cengage": { "courseKey": "WA-production-1606311" }
  }
}
```

## Tests

- `tests/get-assignments-tool.test.ts`
- `tests/course-platform-index.test.ts`
- `tests/course-platform-matcher.test.ts`
- `tests/e11-contracts.test.ts`

## Technical Notes

- Source: `src/tools/assignments.ts`.
- Input/response schemas: `src/tools/assignment-contracts.ts`.
- Permanent index: `src/tools/assignments/platform-index.ts`.
- Matcher: `src/tools/assignments/course-matcher.ts`.
- Normalization: `src/tools/assignments/normalize.ts`.
- eClass typed service: `src/tools/eclass-service.ts`.
- Cengage typed service: `src/tools/cengage/service.ts`.
- WebAssign context verification: `src/scraper/cengage/course-context.ts`.
