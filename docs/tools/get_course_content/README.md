# `get_course_content`

## Features

- Fetches structured section/item map for a course.
- Cache keys use the shared cache schema helper: `getCacheKey("content", courseId)`, stored as versioned `v1_content_*.json` filenames.
- Includes links/resources/activities parsed from course page.

## Data source

1. **Token REST** `core_course_get_contents`, when the function is in the token's service. Only modules with `visible` and `uservisible` set are listed; the external-platform classifier is shared with the other paths.
2. **Session AJAX** course-format state, when REST is unavailable or fails with a fallback-eligible error.
3. **Playwright** course page (fallback and default mode).

Mode is `ECLASS_API_SOURCE_MODE`: `playwright` (default) never calls REST; `shadow` runs both paths, returns Playwright data, and logs only mismatch categories; `api` returns the API result with one bounded Playwright fallback. REST is skipped (not failed) when no mobile credential is stored; a rejected token re-mints once through the cookie session (ADR 0011).

## Known Problems

- Layout drift in Moodle themes can still require selector updates, but the current implementation is working in Claude.

## Tests

- MCP prompt: "List sections and files for course <ID>."
- Script: `npx ts-node scripts/test-scraper.ts`
- E2E matrix row: `docs/t11-e2e-handbook.md`.

## Edge Cases

- Invalid `courseId` or course not accessible.
- Courses with custom blocks/HTML layouts.

## Technical Notes

- Source: `src/tools/content.ts` -> `scraper.getCourseContent(courseId)`.
- Shares `TTL.CONTENT` with section text.
- Verified against the current Claude Desktop flow on 2026-03-23.
