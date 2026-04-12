# `get_announcements`

## Features

- Fetches recent announcements, optionally scoped by `courseId`.
- Supports `limit` argument (default 10).
- Cached per `(courseId, limit)` combination.

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
