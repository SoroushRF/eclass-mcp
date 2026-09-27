# `list_courses`

## Features

- Returns enrolled eClass courses via `src/tools/courses.ts`.
- Uses cache key `courses` with `TTL.COURSES`.
- Auto-triggers auth flow on `SessionExpiredError`.
- Returns explicit diagnostics when auth is required (`status="auth_required"`) or no courses are detected (`status="no_data"`).

## Data source

1. **Session AJAX** enrolled-course function (primary in `api` and `shadow` modes).
2. **Token REST** `core_enrol_get_users_courses`, only when the AJAX read fails (for example, expired cookies). A rate limit is never retried over REST. If both fail, the AJAX error is reported.
3. **Playwright** dashboard (fallback and default mode).

Mode is `ECLASS_API_SOURCE_MODE`: `playwright` (default) never calls REST; `shadow` runs both paths, returns Playwright data, and logs only mismatch categories; `api` returns the API result with one bounded Playwright fallback. REST is skipped (not failed) when no mobile credential is stored; a rejected token re-mints once through the cookie session (ADR 0011).

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
- Passport York login HTML can be returned at non-login URLs; scraper now detects this and returns `auth_required` instead of a silent empty list.

## Technical Notes

- Source modules: `src/tools/courses.ts`, `src/scraper/eclass.ts`, `src/cache/store.ts`.
- Auth handoff: `src/auth/server.ts` (`openAuthWindow()`).
