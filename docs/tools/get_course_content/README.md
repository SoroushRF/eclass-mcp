# `get_course_content`

## Features

- Fetches structured section/item map for a course.
- Cache key format: `content_v4_<courseId>`.
- Includes links/resources/activities parsed from course page.

## Known Problems

- Cache key still uses a manual version suffix (`v4`), which is fine for now but not ideal long term.
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
