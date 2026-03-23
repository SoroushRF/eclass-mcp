# `get_grades`

## Features
- Returns gradebook data for all courses or one `courseId`.
- Caches results to reduce repetitive gradebook page scraping.
- Uses standard auth recovery behavior on expired sessions.

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
- Cache key format: `grades_v2_<course|all>`.
- TTL: `TTL.GRADES`.
- Verified against the current Claude Desktop flow on 2026-03-23.
