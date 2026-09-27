# `get_announcements`

## Features

- Fetches recent announcements, optionally scoped by `courseId`.
- Supports `limit` argument (default 10).
- Cached per `(courseId, limit)` combination.

## Data source

1. **Token REST**, only when `courseId` is given: `mod_forum_get_forums_by_courses` finds the course's `news` forum, then `mod_forum_get_forum_discussions` returns the newest `limit` discussions. The first post's HTML becomes plain-text `content`; external links are extracted with the same filter as the HTML path. A course without a news forum returns an empty list.
2. **Playwright** forum pages for site-level news (no `courseId`), as the fallback, and in the default mode.

Dates from REST are ISO 8601 timestamps; the Playwright path returns the page's display text.

Mode is `ECLASS_API_SOURCE_MODE`: `playwright` (default) never calls REST; `shadow` runs both paths, returns Playwright data, and logs only mismatch categories; `api` returns the API result with one bounded Playwright fallback. REST is skipped (not failed) when no mobile credential is stored; a rejected token re-mints once through the cookie session (ADR 0011).

## Known Problems

- Announcement body formatting can still vary by course theme/plugin.
- Duplicate-row behavior has been handled well enough for current Claude usage, but it is still worth watching on new course layouts.

## Tests

- Prompt: "Recent announcements" (optionally for a specific course).
- E2E matrix row in `docs/t11-e2e-handbook.md`.

## Edge Cases

- No announcements available.
- Very long posts with embedded HTML artifacts.

## Technical Notes

- Source: `src/tools/announcements.ts`.
- Cache key format: `announcements_<course|all>_<limit>`.
- TTL: `TTL.ANNOUNCEMENTS`.
- Verified against the current Claude Desktop flow on 2026-03-23.
