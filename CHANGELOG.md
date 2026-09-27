# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added pull request and issue templates, and documented Conventional Commits and the documentation rule in `CONTRIBUTING.md`.
- Added the eClass mobile token findings log (`docs/investigations/eclass-mobile-token-findings.md`) and proposed ADR 0011 for Moodle mobile token REST access.
- Added `npm run probe:mobile`, an account-owner diagnostic that mints a Moodle mobile token and reports only shapes (mint result, token length, private token presence, release, function count, routing presence). `npm run doctor` now reports the mobile credential state without values.
- Routed eClass reads to Moodle mobile REST in `api` and `shadow` modes when a mobile token is stored: course content, grades, course announcements, and the eClass assignment index (with read-only submission status). Course lists and deadlines stay on session AJAX and use REST only as a fallback. Every function is capability-gated, falls back to Playwright, and is not yet promoted; the default mode is unchanged.
- Added optional QR login (ADR 0012), off unless `ECLASS_MCP_ENABLE_QR_LOGIN=1`: `/auth-qr` exchanges the pasted eClass profile QR payload for a Moodle mobile token via `tool_mobile_get_tokens_for_qr_login`, with CSRF protection, strict origin checks, mapped Moodle errors (including `expiredkey`), and no key or token in logs. The token is verified against the QR account through cookie-free site info before it is saved, and a different account's cookies, API contexts and caches are replaced rather than merged. A token can now be stored before any cookie login without counting as a fresh cookie session.
- `/auth` now mints a Moodle mobile token right after login (best effort). `/status` reports `mobileToken: present|absent`, and with a stored token in `shadow`/`api` mode the server no longer opens the login window at startup for a stale cookie session; cookie-only reads still open it on demand. `npm run doctor` explains the order of operations.
- Added a token-only Moodle REST transport (`fetch`, no browser context) and token-authenticated file downloads through `/webservice/pluginfile.php` outside `playwright` mode, with Playwright fallback except for rate limits and size caps.
- Added T37 `prepare_assignment_submission`, a read-only assignment preflight tool that resolves eClass/Moodle and Cengage/WebAssign targets, signs exact `preflightRef` facts, blocks unsafe intended files or finalized/no-upload states, and marks external-platform writes unsupported for now.
- Added Windows Codex Desktop setup support with `npm run setup:codex`, safe TOML merge/backup/restore handling, and doctor checks for the Codex `mcp_servers.eclass` registration.
- Added follow-up ADR coverage for the MCP tool boundary, RMP circuit breaker, structured trace correlation, manual dependency injection, and read-only cache observability (`docs/adr/0005` through `0009`, plus the ADR index).
- Added stdio MCP smoke coverage for real entrypoint tool discovery, plus additional protocol coverage for read-only pin listing, Cengage argument validation, and RMP detail error responses.
- Added deeper protocol coverage for injected SIS and Cengage tool calls, plus an unmocked RMP circuit-breaker path through MCP `callTool`.
- Added safe MCP `callTool` coverage for injected eClass read paths (`get_course_content`, `get_upcoming_deadlines`, `get_deadlines`, `get_grades`, and `get_announcements`) without live credentials, browsers, or upstream network calls.
- Added property-based coverage for eClass date parsing, URL-policy negative cases, and structured E12 error-envelope invariants.

### Security

- Upgraded `adm-zip` to 0.6.1 (crafted ZIP memory exhaustion and path traversal advisories; used by the PPTX parser) and applied non-breaking fixes for transitive advisories in `undici`, `hono`, `path-to-regexp`, `fast-uri`, `ip-address`, and `@xmldom/xmldom`. `npm audit` reports 0 vulnerabilities.

### Changed

- Restructured CI: platform-independent checks run once, tests run on Windows and Ubuntu with Node 22/24 plus the Node 20 floor, a runtime `npm audit` gate was added, and dependency review now skips with a notice when the repository Dependency graph is off instead of failing every PR.
- Clarified that the shared tool boundary is intentionally family-specific: eClass/SIS and RMP use shared boundary helpers, while Cengage, assignment resolver, cache, and pin tools preserve their specialized envelopes.
- Extended tool-layer dependency injection documentation and tests to include Cengage scraper factories.
- Added the default eClass boundary fallback for unexpected errors as a redacted `INTERNAL_ERROR` JSON response while keeping generic and specialized tool-family boundaries explicit.
- Changed SIS and RMP unknown failures to return redacted structured `INTERNAL_ERROR` JSON instead of leaking raw exception messages or surfacing protocol-level internal errors.
- Mapped `get_assignments` upstream failures into its existing resolver envelope with stable E12 machine codes.

### Fixed

- The REST client tied its user id and function list to the first token it saw; a new login, QR login or renewal kept using the old identity. Identity is now bound to the active token and re-read for any other one, and in `api` mode the cache account scope comes from it.
- Concurrent reads with a rejected token each minted a new one, and a renewal still running at logout could save a token afterwards. Reads now share one renewal, and a renewal saves only if no login or logout happened since it started.
- A token read that finished after a login, logout or account switch still returned the previous account's result. Each read is now bound to the auth generation it started in and is rejected (`credential_changed`, not retried on another transport) if that changed; a same-account renewal keeps the result.
- A read that arrived while a token renewal was running failed at once, and REST routing, token downloads and token-only auth recovery treated the renewal window as "no token". New reads now wait for a renewal from the current login; logout makes it unjoinable.
- In `api` mode the cache account scope was set only on first site-info discovery, so a scope cleared or changed by another path stayed wrong. It is now set from the verified user id before every tool call.
- `playwright` mode still minted after login and sent token file downloads. It now sends no token traffic.
- `shadow` mode was treated as token-only; only `api` is. Token-only `api` reads no longer start Chromium to look for cookies.
- `npm run probe:mobile` read site info through the browser's cookie session and passed with an empty function list. It now uses the production cookie-free transport, requires a user id and functions, and has `--verify-only`.
- The REST assignment index always returned an empty section; section names now come from course contents.
- An unreadable assignment status was reported as "No submission"; it is now "Unknown (status unavailable)". Personal extensions set the effective due date.
- REST deadlines read only the first 50 global events, so a busy course hid others. Reads now use the course-scoped function or page with a bound, and fail instead of returning a truncated list.
- A validation failure, rate limit or oversized response is no longer retried on another transport or hidden behind an earlier AJAX error.
- Shadow comparisons checked little more than ids and names. They now compare multiplicity, section titles and membership, grade range, percentage and feedback, announcement content, author, links and date, and assignment submission state and due date; unreadable dates fail as `*_unverified`. The assignment index also compares course, URL, type, section and grade, body text keeps word boundaries, and each operation's compared fields and deliberate exclusions are documented. A shadow read that fell back is reported as `api_path_fell_back`, and a timed-out shadow read stops issuing calls.
- Fixed the Moodle mobile launch parser: `launch.php` redirects to `moodlemobile://token=<base64(md5(wwwroot+passport):::token[:::privatetoken])>`, which the old query-string parser could never read. The md5 prefix is now verified against this process's passport.
- Redacted Moodle app scheme payloads, private tokens, and QR login keys in logs.
- Fixed the `mod_forum_get_forums_by_courses` REST schema, which expected an object although Moodle returns a bare array.
- Fixed a date-dependent session test whose hard-coded mobile credential expiry had passed.
- Corrected the ADR index status for ADR 0010 (Accepted behind the `playwright` default).
- Removed the remaining production `Promise<any>` type escape hatch and tightened the static production typing guard.
- Added a defensive, redacted `cache_health` failure envelope for unexpected local health-collector failures.
- Fixed stale docs that still referenced old tool counts or request-id-only logging, and corrected changelog wording around Cengage dependency injection.
- Fixed a Cengage assignment parser import order issue that could break real stdio startup before MCP initialization.
- Aligned final maturity docs around the canonical tool-boundary model, redacted `INTERNAL_ERROR` policy, current 25-tool manual matrix, historical T19 tool-surface wording, Cengage's four-tool surface, T25/T26 cache labels, and E20/E21 write-safety status.

## [1.0.0-beta.3] - 2026-05-20

### Added

- Added E20 write-preflight contract helpers: shared Zod schemas, signed preflight references, and write-specific machine codes for future assignment/calendar write tools.
- Added MCP protocol-level integration tests that construct the real server through the SDK path and verify tool discovery, schemas, safe validation errors, and cache-tool protocol semantics. Direct cache suites cover real cache behavior; the initial protocol cache checks use safe mocks where needed.
- Added an RMP external-service circuit breaker so repeated upstream failures fail fast with structured `RATE_LIMITED` responses instead of hammering RateMyProfessors.
- Added structured trace correlation fields (`traceId`, `spanId`, `parentSpanId`) with root tool spans, tool-boundary spans, RMP GraphQL spans, and structured runtime events for circuit-breaker and shutdown paths.
- Added read-only cache observability with process-local cache metrics, cache health scanning, and the public `cache_health` MCP tool.
- Added a safe manual E2E/release harness template generator with current 25-tool Inspector and Claude Desktop matrices.

### Changed

- Eliminated production `as any` casts, tightened remaining production `any` annotations, and kept MCP registration on typed `registerTool` helpers.
- Centralized common eClass/SIS tool error and auth handling behind a shared tool boundary while preserving public response shapes.
- Added graceful shutdown cleanup for stdio transport, auth server/browser resources, eClass scraper, Cengage scraper registry, and SIS browser tracking.
- Reduced tool-layer scraper/client singleton coupling through explicit manual dependency injection for eClass, SIS, RMP, and Cengage tool paths.
- Updated package metadata, docs, and release surfaces for `1.0.0-beta.3`.

### Fixed

- Hardened authenticated URL boundaries against unsafe schemes, host spoofing, arbitrary authenticated navigation/fetch, private-network targets, and sensitive URL leakage.

### Tests

- Added static production-any regression coverage.
- Added protocol, boundary, shutdown, lifecycle, circuit-breaker, trace, cache-health, dependency-injection, and E2E-template regression suites.

### Documentation

- Added `docs/operational-limits.md` to document current timeouts, auth waits, concurrency posture, retry behavior, rate-limit handling, and future runtime safety guidance.
- Replaced the old write-tool env-gate plan with an accuracy-first preflight + confirmation + target revalidation model in README, SECURITY, E11/E12 docs, and the master tracker.
- Updated live/manual E2E, release, logging, cache, protocol, and operational docs to reflect the completed maturity initiative.

## [1.0.0-beta.2] - 2026-05-15

### Upgrade Notes

- Set `ECLASS_MCP_SESSION_SECRET` in `.env` before authenticating; saved eClass/SIS and Cengage/WebAssign auth material now requires this local secret.
- Legacy plaintext `.eclass-mcp/session.json` and `.eclass-mcp/cengage-state.json` files are intentionally rejected; clear auth sessions with `http://localhost:<AUTH_PORT>/logout` or delete those auth files, then re-authenticate.
- Run `npm run doctor` for a read-only setup health check before debugging local MCP issues.
- Preview Claude Desktop config changes with `npm run setup -- --dry-run`; normal setup now creates backups and can restore them with `npm run setup -- --restore latest`.

### Added

- Cengage/WebAssign read integration, including persistent local auth, dashboard-first course discovery, URL/state classification, assignment parsing, bounded all-course aggregation, list/discover tools, and assignment question-detail extraction.
- Cross-platform assignment resolver that merges eClass and Cengage/WebAssign assignment surfaces, tracks course-platform mappings, and exposes structured retry metadata for course activation and auth-required cases.
- eClass external-platform discovery from course content, announcements, and item details so downstream assignment flows can identify Cengage/WebAssign and other linked platforms without manual URL entry.
- E11 output schema validation for tool responses, plus E12 machine-code error categories for session expiry, scrape-layout drift, upstream failures, rate limits, timeouts, and validation errors.
- E13 secure-file session storage using encrypted auth envelopes for eClass/SIS cookies and Cengage/WebAssign Playwright storage state.
- Local `/logout` cleanup for auth session files only, with cache, pins, debug output, and course-platform mappings left intact.
- E14 structured JSON logging to stderr with request/tool context and redaction helpers.
- E15 typed selector registry with selector winner logging, structured `SCRAPE_LAYOUT_CHANGED` drift context, and opt-in selector debug snapshots.
- E16 `npm run doctor` environment health check for Node/npm, build artifacts, Playwright Chromium, `.env`, secure-session posture, auth/session hints, Claude Desktop config, permissions, and parser dependencies.
- E17 safe setup workflow with `--dry-run`, timestamped Claude config backups, backup listing, validated restore, and atomic config writes.
- Release documentation for `v1.0.0-beta.2`, including a full-history commit audit ledger and reusable release checklist.
- Lightweight ADRs for the local-first MCP boundary, encrypted local sessions, versioned file cache, and selector registry.

### Changed

- Raised the branch coverage gate to 75% and shifted coverage toward behavior-focused regression tests rather than filler line touches.
- Refactored Cengage/WebAssign scraper and tool internals into smaller navigation, dashboard, assignment, cache, mapper, response, and service modules.
- Hardened eClass/SIS auth retry behavior so tools can wait through local auth and retry without forcing the user to re-prompt.
- Updated Claude Desktop setup to preserve unrelated config entries and fail safely on malformed or unsafe config shapes.
- Updated package and README engine stage to `1.0.0-beta.2`.
- Updated package metadata, publish allowlist, Node engine requirement (`>=20.19.0`), and pack dry-run checks.

### Fixed

- Fixed lazy-loaded dashboard and announcement scraping races.
- Fixed Cengage OWLv2 dashboard course listing and past-assignment tab coverage.
- Fixed Moodle wrapper/file download branches, filename fallbacks, unknown MIME fallback handling, and structured file-tool upstream errors.
- Fixed Windows/OneDrive-style course-platform index rename behavior by preserving meaningful filesystem errors and testing transient retry paths.
- Fixed Passport York/login-state detection and Cengage auth-expired recovery parity.
- Fixed several Cengage assignment extraction edge cases around prompt sections, rendered media caps, dashboard titles, dedupe identity, and redirect state.
- Fixed scoped `clear_cache` invalidation for versioned cache keys.
- Fixed swapped Cengage secure-session response helpers for assignment-list vs assignment-detail tools.
- Avoided duplicate image downloads in `get_item_details`.
- Cached legitimate empty eClass course/deadline results briefly to avoid repeated scrapes.
- Added PDF page-range validation for impossible ranges and an RMP GraphQL request timeout.

### Security

- Encrypted local auth session material at rest using the configured session secret.
- Added `SESSION_STORAGE_UNAVAILABLE` handling for missing, weak, wrong, legacy, malformed, or undecryptable secure-session state.
- Added best-effort auth-session wipe behavior and documented secure-wipe limitations on SSDs, sync folders, and backups.
- Added log redaction and structured logging rules that keep MCP stdout clean and avoid exposing cookies, secrets, and decrypted session contents.

### Tests

- Added Cengage/WebAssign fixture, URL, state, selection, dashboard inventory, assignment parser, assignment details, and tool-response regression suites.
- Added eClass DOM scraper, file-download, announcements, item-details, auth-retry, secure-session, selector-registry, and parser regression tests.
- Added doctor/setup script tests that exercise Claude config path resolution, dry-run behavior, backups, restore validation, env checks, and session-file diagnostics without mutating real user config.
- Added contract and structured-error tests for E11/E12 machine-code response behavior.
- Added focused property tests for cache keys and Cengage URL normalization, plus regression tests for cache invalidation, PDF range validation, and RMP timeouts.

### Documentation

- Updated README, SECURITY, PROJECT_MASTER, E11/E12 references, E2E handbook, and per-tool docs for Cengage/WebAssign, assignment resolver, secure sessions, selector diagnostics, doctor, and setup recovery.
- Added release notes, release checklist, and full-history commit audit documentation for the `v1.0.0-beta.2` release candidate.
- Corrected stale cache-key, privacy, Node runtime, WeBWorK-current-state, and live E2E-status claims.

## [1.0.0-beta.1] - 2026-03-27

### Added

- RateMyProfessors engine with professor search, details lookup, rating tags, diagnostics, and stricter typed outputs.
- SIS expansion with exam schedule and class timetable tools using bridged eClass/SIS cookies.
- Smart cache system with freshness envelopes, scoped clearing, versioned cache keys, user-pinned cache tier, quotas, and cache-management MCP tools.
- Root governance docs, per-tool READMEs, E2E handbook/run logs, release-policy notes, and engine/product version-line separation.

### Changed

- Consolidated session errors and browser-launch reliability around `SessionExpiredError`.
- Updated package entry point to `dist/index.js` for Claude Desktop setup.
- Tightened CI, lint, formatting, TypeScript, and early Vitest quality gates.
- Reworked docs and task numbering around the engine beta line, SIS/RMP expansion, and post-beta engineering roadmap.

### Fixed

- Fixed RMP output shape, diagnostics typing, and CI lint gaps.
- Fixed cache envelopes, file-tool content handling, navigation, and section URL behavior.
- Fixed course and announcement scraper races for lazy-loaded dashboard state.
- Removed obsolete root debug output and stale one-off probe artifacts from the active workflow.

## [0.9.0-core] - 2026-03-23

### Added

- Governance baseline with `PROJECT_MASTER.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `CODE_OF_CONDUCT.md`.
- Multimodal item-detail support with vision image block extraction and payload caps.
- Inline CSV attachment support with size limits.
- Moodle 4 deadline, assignment, quiz, grade, announcement, section, and file scraping improvements.
- Formal CI/test/lint/format foundation and first unit tests for cache, session, and PPTX/parser behavior.

### Changed

- Modernized universal course structure extraction for Moodle 4 side-drawer, custom tabs, embedded links, and one-section-per-page fallbacks.
- Restructured `get_file_text` so `courseId` is optional and attachment hints are clearer.
- Consolidated scattered planning notes into the project master document.

### Fixed

- Fixed Windows Store Claude path issues by using absolute `.env`, cache, and session paths.
- Fixed Moodle HTML wrapper downloads, JavaScript-rendered file wrappers, WAF token capture, and wrapper fallback behavior.
- Fixed grades, quiz grade extraction, assignment feedback extraction, course naming consistency, and announcement duplication.

## [0.1.0] - 2026-03-19

### Added

- Core MCP server scaffold with Playwright-backed eClass auth, session storage, cache helpers, and initial MCP tool wiring.
- Initial eClass scraper/tool coverage for courses, assignments, files, grades, announcements, sections, and deadlines.
- Smart PDF pipeline with per-page metadata analysis, text extraction, rendered image pages, mixed-content caching, page ranges, and payload guardrails.
- Setup scripts and local smoke-test scripts for Claude Desktop integration.

### Fixed

- Fixed early browser singleton/resource cleanup issues.
- Fixed auth server responses and eClass selector naming inconsistencies.
- Fixed first-pass Moodle dashboard, deadline, and download behavior enough to support the initial E2E loop.
