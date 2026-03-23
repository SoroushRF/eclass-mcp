# `list_courses`

## Features
- Returns enrolled eClass courses via `src/tools/courses.ts`.
- Uses cache key `courses` with `TTL.COURSES`.
- Auto-triggers auth flow on `SessionExpiredError`.

## Known Problems
- No response metadata (`cache_hit`, `fetched_at`) yet.
- Returns plain text JSON payload (not typed envelope).

## Tests
- MCP prompt: "What courses am I enrolled in?"
- Script: `npx ts-node -P scripts/tsconfig.json scripts/test-scraper.ts`
- E2E matrix row: see `docs/t11-e2e-handbook.md`.

## Edge Cases
- Empty course list (enrollment or permission issue).
- Stale/invalid session cookie file.

## Technical Notes
- Source modules: `src/tools/courses.ts`, `src/scraper/eclass.ts`, `src/cache/store.ts`.
- Auth handoff: `src/auth/server.ts` (`openAuthWindow()`).
