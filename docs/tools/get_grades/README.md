# `get_grades`

## Features

- Returns gradebook data for all courses or one `courseId`.
- Caches results to reduce repetitive gradebook page scraping.
- Uses standard auth recovery behavior on expired sessions.

## Data source

1. **Token REST**: `gradereport_user_get_grade_items` for one `courseId` (hidden grades are omitted; the course row is named `Course total`), or `gradereport_overview_get_course_grades` for all courses, with course names from `core_enrol_get_users_courses`.
2. **Playwright** gradebook pages (fallback and default mode). There is no session AJAX path for grades.

Mode is `ECLASS_API_SOURCE_MODE`: `playwright` (default) never calls REST; `shadow` runs both paths, returns Playwright data, and logs only mismatch categories; `api` returns the API result with one bounded Playwright fallback. REST is skipped (not failed) when no mobile credential is stored; a rejected token re-mints once through the cookie session (ADR 0011).

## Known Problems

- Course-specific gradebook layouts can vary slightly.
- Feedback/extra columns are best-effort normalized, but the main grade rows are now stable in Claude.

## Tests

- Prompt: "What are my grades?" or "What are my grades for course <ID>?"
- E2E matrix row in `docs/t11-e2e-handbook.md`.

## Edge Cases

- Courses with no posted grades.
- Hidden grade items or permission-limited views.

## Technical Notes

- Source: `src/tools/grades.ts`.
- Cache keys use the shared cache schema helper, stored as versioned `v1_grades_*.json` filenames.
- TTL: `TTL.GRADES` (3 hours).
- Verified against the current Claude Desktop flow on 2026-03-23.
