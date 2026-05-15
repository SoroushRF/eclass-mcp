# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added E20 write-preflight contract helpers: shared Zod schemas, signed preflight references, and write-specific machine codes for future assignment/calendar write tools.

### Documentation

- Added `docs/operational-limits.md` to document current timeouts, auth waits, concurrency posture, retry behavior, rate-limit handling, and future runtime safety guidance.
- Replaced the old write-tool env-gate plan with an accuracy-first preflight + confirmation + target revalidation model in README, SECURITY, E11/E12 docs, and the master tracker.

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

### Changed

- Raised the branch coverage gate to 75% and shifted coverage toward behavior-focused regression tests rather than filler line touches.
- Refactored Cengage/WebAssign scraper and tool internals into smaller navigation, dashboard, assignment, cache, mapper, response, and service modules.
- Hardened eClass/SIS auth retry behavior so tools can wait through local auth and retry without forcing the user to re-prompt.
- Updated Claude Desktop setup to preserve unrelated config entries and fail safely on malformed or unsafe config shapes.
- Updated package and README engine stage to `1.0.0-beta.2`.

### Fixed

- Fixed lazy-loaded dashboard and announcement scraping races.
- Fixed Cengage OWLv2 dashboard course listing and past-assignment tab coverage.
- Fixed Moodle wrapper/file download branches, filename fallbacks, unknown MIME fallback handling, and structured file-tool upstream errors.
- Fixed Windows/OneDrive-style course-platform index rename behavior by preserving meaningful filesystem errors and testing transient retry paths.
- Fixed Passport York/login-state detection and Cengage auth-expired recovery parity.
- Fixed several Cengage assignment extraction edge cases around prompt sections, rendered media caps, dashboard titles, dedupe identity, and redirect state.

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

### Documentation

- Updated README, SECURITY, PROJECT_MASTER, E11/E12 references, E2E handbook, and per-tool docs for Cengage/WebAssign, assignment resolver, secure sessions, selector diagnostics, doctor, and setup recovery.
- Added release notes, release checklist, and full-history commit audit documentation for the `v1.0.0-beta.2` release candidate.

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
