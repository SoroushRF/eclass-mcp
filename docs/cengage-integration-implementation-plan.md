# Cengage Integration Hardening Plan

## Obsolete Notice

This file is obsolete and should only be used for context and reference.

## Overall Goal

Build a reliable, production-grade Cengage/WebAssign integration that:

- Accepts multiple valid entry link shapes (eClass LTI link, Cengage dashboard link, WebAssign course link, login link).
- Works with the user's authenticated session and navigates reliably through redirect/interstitial flows.
- Lets Claude discover and traverse multiple courses from the Cengage dashboard.
- Extracts assignment/deadline data with stable parsing and structured, cache-aware MCP responses.
- Discovers Cengage links even when buried across eClass surfaces (course sections, announcements, assignment text, and attached files).

## Non-Negotiable Execution Rule

Implementation will follow this strict workflow:

1. Work on exactly one task at a time.
2. Finish that task completely.
3. Report completion and evidence.
4. Stop and wait for explicit green light before starting the next task.

## Tool Architecture Decision

Use multiple Cengage MCP tools plus a compatibility path.

Proposed tools:

1. `discover_cengage_links`
2. `list_cengage_courses`
3. `get_cengage_assignments`

Migration note:

- Keep current `get_cengage_assignments` behavior as a compatibility mode during migration.
- Move it to the new navigation core so existing prompts do not break.

## Critical Implementation Notes

- Keep this track read-only (no submissions or form writes).
- Do not hardcode auth port in error/help messages.
- Use structured JSON responses with `_cache` metadata parity with existing tools.
- Use typed errors instead of string matching (`SessionExpiredError` style behavior for Cengage path).
- Build navigation as a state machine, not single-shot `goto + waitForURL`.
- Treat URL intake as untrusted/variable input: normalize, classify, then route.
- Add robust selector strategies and graceful fallback extraction paths.
- Add tests and fixtures before claiming hardening complete.

## Definition of Done (Program-Level)

The Cengage hardening track is done when:

1. Dashboard link and direct course link both pass in Inspector.
2. Multi-course dashboards can be listed and course-selected reliably.
3. Assignment extraction is stable across known HTML variants.
4. Cengage tools return structured JSON + `_cache` metadata.
5. Auth expiration flow uses the same reliability pattern as other tools.
6. eClass discovery finds Cengage links across sections, announcements, item descriptions, and files.
7. Unit tests + fixture tests + E2E docs/log updates are in place.

## Micro-Task Plan

## Phase 1: Contracts, Errors, and Session Foundations

### T01 - Finalize Cengage tool contracts and schemas

Description:

- Define exact MCP input/output contracts for discovery, course listing, and assignment retrieval.

Implementation notes:

- Define supported inputs: raw URL, pasted text containing URL, optional course selector.
- Define standard response envelope with `_cache` and machine-usable status fields.

Done criteria:

- Contracts documented and reflected in code-level schemas.

Dependencies:

- None.

### T02 - Add typed Cengage error model

Description:

- Replace fragile string-based error checks with typed errors.

Implementation notes:

- Add Cengage-specific session/auth/navigation errors.
- Ensure tool layer maps each error to stable, structured response shape.

Done criteria:

- No Cengage logic depends on `error.message.includes(...)` for control flow.

Dependencies:

- T01.

### T03 - Build URL normalizer and classifier

Description:

- Convert messy user input into canonical URL + link type.

Implementation notes:

- Support: LTI links, Cengage dashboard links, WebAssign course links, login links.
- Handle malformed text and whitespace around pasted links.

Done criteria:

- Classifier returns deterministic type + normalized URL for known patterns.

Dependencies:

- T01.

### T04 - Add URL classifier tests (real variants)

Description:

- Add comprehensive test matrix for URL intake.

Implementation notes:

- Include real-world variants from known logs/dumps.
- Include negative tests and malformed inputs.

Done criteria:

- Tests pass and cover all supported link classes.

Dependencies:

- T03.

### T05 - Add Cengage session staleness validation

Description:

- Treat Cengage auth state similarly to eClass session freshness.

Implementation notes:

- Persist metadata and apply staleness checks, not just file existence checks.
- Raise typed session-expired errors when stale/invalid.

Done criteria:

- Scraper rejects stale state before navigation and emits typed error.

Dependencies:

- T02.

### T06 - Add dynamic auth URL helper

Description:

- Remove hardcoded auth URLs and use actual auth server port.

Implementation notes:

- Build helper to return live auth URL(s) safely.
- Replace hardcoded `http://localhost:3000/...` messages.

Done criteria:

- Auth links in Cengage responses remain correct when port 3000 is occupied.

Dependencies:

- T02.

## Phase 2: Navigation Engine and Data Extraction

### T07 - Build Cengage navigation state detector

Description:

- Detect runtime page state: login, dashboard, course, assignments, unknown.

Implementation notes:

- Use URL + DOM signals, not URL regex alone.
- Include fallback diagnostics payload for unknown states.

Done criteria:

- State detection is deterministic across target fixtures/pages.

Dependencies:

- T03, T05.

### T08 - Add dashboard course inventory extraction

Description:

- Extract all available courses from Cengage/WebAssign dashboard context.

Implementation notes:

- Capture course title, launch URL, and stable identifiers where available.
- Include confidence field if data quality varies.

Done criteria:

- Multi-course dashboards return structured list consistently.

Dependencies:

- T07.

### T09 - Add course selection resolver

Description:

- Resolve course choice by exact id, key, or fuzzy name query.

Implementation notes:

- Deterministic match order: id -> exact name -> normalized/fuzzy fallback.
- Return disambiguation options when selection is ambiguous.

Done criteria:

- Resolver never silently picks the wrong course.

Dependencies:

- T08.

### T10 - Build assignment parser v1 (stable selectors)

Description:

- Parse assignments from course context with selector fallbacks.

Implementation notes:

- Avoid broad global selectors that pick unrelated rows.
- Scope extraction to known assignment containers.

Done criteria:

- Parser extracts assignment rows on all current fixture variants.

Dependencies:

- T07.

### T11 - Add robust due-date and status parsing

Description:

- Improve date normalization and status determination.

Implementation notes:

- Stop inferring "submitted" from generic slash patterns.
- Parse known date formats and preserve raw source text for traceability.

Done criteria:

- Status and date are accurate on fixture set and manual sanity checks.

Dependencies:

- T10.

### T12 - Improve dedupe identity

Description:

- Dedupe assignments using course-aware identity.

Implementation notes:

- Use course id + assignment id/url + normalized title fallback.
- Avoid title-only dedupe collisions.

Done criteria:

- Duplicate suppression does not collapse distinct assignments.

Dependencies:

- T10.

## Phase 3: MCP Tool Wiring and Behavior Parity

### T13 - Add `discover_cengage_links` tool wiring

Description:

- Register discovery tool and expose normalized candidates.

Implementation notes:

- Return source location context (where link was found).
- Keep response compact and deterministic.

Done criteria:

- Tool callable in Inspector and returns structured candidates.

Dependencies:

- T01, T03.

### T14 - Add `list_cengage_courses` tool wiring

Description:

- Register course listing tool using navigation core.

Implementation notes:

- Input accepts entry URL and optional discovery result.
- Output includes course identity fields needed by next step.

Done criteria:

- Inspector flow can list dashboard courses from valid entry link.

Dependencies:

- T08, T09.

### T15 - Refactor `get_cengage_assignments` onto new core

Description:

- Move current tool to new classified input + navigation + parser stack.

Implementation notes:

- Keep compatibility behavior where practical.
- Ensure direct course links and dashboard-driven course selection both work.

Done criteria:

- Existing and new flows succeed through one unified core.

Dependencies:

- T09, T10, T11, T12.

### T16 - Add cache envelope parity

Description:

- Bring Cengage responses to cache metadata contract parity.

Implementation notes:

- Use same `_cache` model used in current tool stack.
- Include hit/miss, fetched_at, expires_at, stale when applicable.

Done criteria:

- Cengage responses are structured and cache-transparent.

Dependencies:

- T15.

### T17 - Add auth-expired behavior parity

Description:

- Apply reliable auth-recovery behavior to Cengage tool path.

Implementation notes:

- Open auth flow reliably and return machine-usable retry guidance.
- Avoid brittle string matching.

Done criteria:

- Session-expired Cengage path behaves consistently with existing platform tools.

Dependencies:

- T02, T06, T15.

## Phase 4: eClass Discovery Expansion (Buried Link Problem)

### T18 - Expand course-content discovery beyond LTI-only signals

Description:

- Detect Cengage links in additional activity/link types.

Implementation notes:

- Cover URL/resource-type activities and non-LTI external links.
- Keep platform classification explicit and inspectable.

Done criteria:

- `external_platforms` captures non-LTI Cengage links where present.

Dependencies:

- T03.

### T19 - Add announcement link extraction

Description:

- Preserve and expose explicit links from announcement bodies.

Implementation notes:

- Keep text summary, but also return structured links array.
- Include source discussion URL for traceability.

Done criteria:

- Announcement payload includes usable external links.

Dependencies:

- T03.

### T20 - Add item-description external link extraction

Description:

- Extract and classify external anchors from assignment/quiz descriptions.

Implementation notes:

- Extend current item detail payload to include external links explicitly.
- Keep current attachment handling intact.

Done criteria:

- Item details expose Cengage/WebAssign links when present in description HTML.

Dependencies:

- T03.

### T21 - Add file-link mining utility

Description:

- Mine candidate external links from extracted file text.

Implementation notes:

- Parse links from PDF/DOCX/PPTX extracted text blocks.
- Return confidence and source file metadata.

Done criteria:

- Syllabus-like file content can surface candidate Cengage links.

Dependencies:

- T03.

## Phase 5: Validation, Docs, and Rollout

### T22 - Add fixtures and tests for navigation + parsing

Description:

- Add robust tests for classifier, state machine, and assignment parser.

Implementation notes:

- Include fixture snapshots for dashboard and course variants.
- Include regression tests for known brittle patterns.

Done criteria:

- Test suite covers core Cengage logic and passes in CI.

Dependencies:

- T07-T12.

### T23 - Add Inspector/E2E scenario coverage

Description:

- Document and execute Cengage-specific test flows.

Implementation notes:

- Add scenarios for direct dashboard link and direct course link.
- Add auth-expired recovery scenario for Cengage.

Done criteria:

- E2E handbook and run log include passing Cengage rows.

Dependencies:

- T13-T17, T22.

### T24 - Update docs and migration notes

Description:

- Publish user-facing and maintainer-facing docs for final behavior.

Implementation notes:

- Document new tools, compatibility behavior, and known constraints.
- Add troubleshooting for link type and auth/session issues.

Done criteria:

- README/docs reflect final Cengage flow and migration guidance.

Status:

- Completed on 2026-04-10.

Evidence:

- `README.md` now includes Cengage tool entries, migration/compatibility notes (`entryUrl` + legacy `ssoUrl`), and troubleshooting guidance for auth/session and link-selection states.
- `docs/tools/README.md` now lists all 22 tools and links to dedicated Cengage tool docs.
- `docs/tools/discover_cengage_links/README.md`, `docs/tools/list_cengage_courses/README.md`, and `docs/tools/get_cengage_assignments/README.md` provide maintainer-facing tool behavior and constraints.

Dependencies:

- T13-T23.

## Recommended Execution Order

1. Complete Phase 1.
2. Complete Phase 2.
3. Wire tools in Phase 3.
4. Expand buried-link discovery in Phase 4.
5. Close out with validation/docs in Phase 5.

## Reporting Template (Use After Each Task)

Use this exact structure after each task completion:

1. Task ID and name.
2. What changed (files and behavior).
3. Validation performed (tests/build/manual).
4. Evidence summary.
5. Risks or follow-ups.
6. Explicit stop, waiting for green light.
