# `get_announcements`

## Features
- Fetches recent announcements, optionally scoped by `courseId`.
- Supports `limit` argument (default 10).
- Cached per `(courseId, limit)` combination.

## Known Problems
- Duplicate rows can occur from forum/thread summary overlap.
- Announcement body formatting can vary by course theme/plugin.

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
