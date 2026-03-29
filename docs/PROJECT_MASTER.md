# eClass MCP ? Project master document

**Canonical planning and history for the eClass MCP repository.**  
**Last updated:** 2026-03-25  

This file subsumes the former root docs (CoYork TODO, v1 implementation plan, engine beta SIS/RMP plan, gap-to-9+ review), which were **removed** from the repo root in favor of this single source of truth.

---

## Table of contents

1. [How to use this document](#1-how-to-use-this-document)
2. [**Master execution tracker & detailed implementation plans**](#2-master-execution-tracker--detailed-implementation-plans) — **start here for what's left to build**
   - [Engine versioning and release policy](#engine-versioning-and-release-policy)
3. [Executive snapshot](#3-executive-snapshot)
4. [Architecture reference](#4-architecture-reference-single-source-of-truth)
5. [Working with AI agents on this repo](#5-working-with-ai-agents-on-this-repo)
6. [MVP vs post-v1 / "perfection" backlog](#6-mvp-vs-post-v1--perfection-backlog)
7. [Original v1 build plan (historical summary)](#7-original-v1-build-plan-historical-summary)
8. [Shipped feature history (deadlines & file pipeline)](#8-shipped-feature-history-deadlines--file-pipeline)
9. [Phase A — Active product backlog (themes)](#9-phase-a---active-product-backlog-themes)
10. [Phase B — Engine beta: external data (SIS, RMP)](#10-phase-b---engine-beta-external-data-sis-rmp)
11. [Phase C — Engineering excellence reference (gap to 9.0+)](#11-phase-c---engineering-excellence-reference-gap-to-90)
12. [Phase D — Maintainer / codebase health](#12-phase-d---maintainer--codebase-health)
13. [Appendix A — Documentation map](#appendix-a---documentation-map)
14. [Appendix B — Scripts directory policy](#appendix-b---scripts-directory-policy)
15. [Appendix C: Superseded root documents (removed)](#appendix-c-superseded-root-documents-removed)

---

## 1. How to use this document

- **User setup and features:** start with the repo [`README.md`](../README.md).
- **What to build next:** use [2](#2-master-execution-tracker--detailed-implementation-plans) — unified checkboxes, serial task IDs, and **step-by-step** plans for everything not done (post-beta engine polish, **T25** `eclass.ts` modularization, **T26** smart cache + `clear_cache`, optional **T27** user-pinned cache + quota, future write tools behind **E20** gates, 9+ engineering **E01-E21**).
- **Deep dives:** deadlines and PDF pipeline live under [`docs/tools/deadlines/`](tools/deadlines/) and [`docs/tools/get_file_text/`](tools/get_file_text/).
- **Deduplication:** stack, session paths, and tool lists appear once in [3](#3-executive-snapshot) and [4](#4-architecture-reference-single-source-of-truth).

---

## 2. Master execution tracker & detailed implementation plans

This section is the **standing implementation plan**: one serial numbering scheme, **checkboxes per task**, and **thick procedural detail** for incomplete work (especially **E2E** and **9+ / CI**).

### 2.1 Task ID legend

| Range | Origin |
| --- | --- |
| **T01-T13** | Original v1 foundation (including next-up SIS Auth) |
| **T14-T20** | Engine beta extension — SIS, RateMyProfessors, E2E verification |
| **T21** | Engine post-beta automation — Cron / proactive notifications |
| **T22-T24** | Optional product polish (parallel track; does not block T14-T20) |
| **T25** | [x] Maintainer: split [`src/scraper/eclass.ts`](../src/scraper/eclass.ts) into `src/scraper/eclass/` — completed; see [2.10](#2.10-detailed-plan---t26-scraper-modularization-eclassts-breakdown) |
| **T26** | [x] Smart cache policy, response freshness metadata, `clear_cache` tool, login invalidation — see [2.11](#211-detailed-plan---t26-smart-cache-metadata---clear_cache-tool) |
| **T27** | User-pinned cache tier, on-disk quota, pin/unpin/list/refresh tools — see [2.12](#2.12-detailed-plan---t27-user-pinned-cache-quota-and-tools) |
| **T28-T31** | Cengage integration — passive discovery, `/auth/cengage` endpoint, scraper + tools, E2E — see [§2.13](#213-detailed-plan--t28-t35-cengage--webwork-assignment-platforms) |
| **T32-T35** | WeBWorK multi-instance integration — discovery, per-host `/auth/webwork?host=` + registry, scraper + tools, E2E — see [§2.13](#213-detailed-plan--t28-t35-cengage--webwork-assignment-platforms) |
| **T36-T39** | Future **write tools** (assignment preflight, submit, calendar, E2E) — see [§2.14](#214-detailed-plan--future-write-tools--safety-t36-t39) |
| **T40** | Auth blocking poll retrofit — apply seamless auto-retry pattern to existing eClass + SIS tools — see [§2.13](#213-detailed-plan--t28-t35-cengage--webwork-assignment-platforms) |
| **E01-E19** | Engineering "gap to 9+" work items (mapped from former `review.md` epics A-D) |
| **E20-E21** | Write-tool **safety** (pre-ship gates, post-write audit + cache invalidation) — see [§2.14](#214-detailed-plan--future-write-tools--safety-t36-t39) |

Status: `[x]` done in repo today ? `[ ]` not done / not verified to standard.

---

### Engine versioning and release policy

This repository now treats the MCP server as an **engine line** that can stay open-source and evolve independently from the eventual product surfaces.

#### Version line

- `0.9.0-core`
  - Historical core-only release.
  - This is the renamed identity for the original core intelligence release before SIS and RMP integration.
  - Treat it as the last core-only milestone, not the stable engine line.

- `1.0.0-beta.1`
  - Current engine stage in this repo.
  - Core eClass tools plus SIS and RMP are integrated.
  - The engine is useful and real, but still being hardened for broader use.

- `1.0.0-beta.2`
  - Cengage and WeBWorK assignment platform integration.
  - Platform discovery engine: passive detection of external platform links from eClass course content — no manual URL configuration required from the user.
  - Per-platform and per-instance auth endpoints; per-hostname WeBWorK session model.
  - Blocking poll / auto-retry pattern introduced for Cengage and WeBWorK, then retrofitted to eClass and SIS (T40) so all tools respond seamlessly without requiring a re-prompt after login.

- `1.0.0`
  - First stable engine release.
  - All read-only tools are dependable — eClass, SIS, RMP, Cengage, and WeBWorK.
  - Seamless auth across all platforms: tools block and auto-retry during login; no re-prompt ever needed.
  - Version contracts, docs, and release discipline are in place.

- `1.1.0`
  - Schedule planning and builder intelligence.
  - Candidate timetable generation, conflicts, preference scoring, and RMP-aware ranking.

- `1.2.0`
  - Registration preflight.
  - Seat checks, eligibility checks, cart validation, and read-only state verification.

- `1.3.0`
  - Opt-in write actions, if they are ever added.
  - Explicit confirmation, safety gates, audit logging, and cache invalidation.

- `2.0.0`
  - Only if the trust model changes materially.
  - For example, if the engine moves from read-only first to a new, broader write-first contract.

#### Release stages

- **Alpha**
  - The engine is still changing quickly.
  - Tool shapes may still move.
  - Docs are catching up.
  - Scrapers may still drift.

- **Beta**
  - The engine is functionally real and usable, but still being hardened.
  - Read-only tools are valuable.
  - Structured outputs are mostly stable.
  - Known issues are documented.

- **Stable**
  - The engine is ready for general use.
  - Tool contracts are stable.
  - Docs and release notes are reliable.
  - Regression handling is documented.

#### Feature boundary

- Keep in the engine:
  - scraping
  - parsing
  - normalization
  - schedule analysis
  - timetable logic
  - professor enrichment
  - read-only workflow helpers
  - local auth/session handling (all platforms — eClass, SIS, Cengage, WeBWorK)
  - platform discovery engine (passive detection of external platform links from eClass course content)
  - per-platform and per-instance session management

- Keep in the product:
  - hosted sync
  - billing
  - premium account features
  - saved preferences and user profiles
  - mobile/web app UX
  - extension UI
  - Telegram bot
  - dashboards and analytics

#### Release policy

- Keep the engine repository focused on integrations and contracts.
- Keep the product repository focused on user experience and monetization.
- Avoid mixing release numbers across the two.
- Document every public engine release with a changelog entry.
- If a release has already been published under the old naming scheme, avoid rewriting public history lightly.

#### Current repo status

- Historical core-only release: `0.9.0-core`
- Current engine stage: `1.0.0-beta.1`
- Next planned beta: `1.0.0-beta.2` (Cengage, WeBWorK, blocking poll / auto-retry for all platforms)
- Next major public engine milestone: `1.0.0`
- Future planning should assume the engine and product will eventually diverge into separate release lines.

---

### 2.2 Tracker ? v1 foundation (T01-T13)

- [x] **T01** ? Project scaffolding (`package.json`, `tsconfig`, `.gitignore`, `.env.example`, `src/` skeleton, `npm` scripts, `.eclass-mcp/` dirs).
- [x] **T02** ? Cache store (`src/cache/store.ts`, TTL constants, get/set/invalidate/clear).
- [x] **T03** ? Session layer (`src/scraper/session.ts`, save/load/validity/clear, stale window).
- [x] **T04** ? Auth HTTP server (`src/auth/server.ts`, `/auth`, `/status`, visible browser for login).
- [x] **T05** ? eClass scraper core (`src/scraper/eclass.ts`, `SessionExpiredError`, real scraping APIs; evolved well beyond original mock stage).
- [x] **T06** ? File parsers (`src/parser/pdf.ts`, `docx.ts`, `pptx.ts`; PDF path later upgraded ? see file-tool docs).
- [x] **T07** ? MCP tool modules (`src/tools/*.ts`, cache + session error handling).
- [x] **T08** ? MCP server entry (`src/index.ts`, stdio transport, tool registration ? **13 tools** today vs original 6).
- [x] **T09** ? Claude Desktop setup helper (`scripts/setup-claude.sh`, `npm run setup` pattern).
- [x] **T10** ? Real York eClass selectors and scraper hardening (ongoing refinement; baseline **done**).
- [x] **T11** ??? **Formal Claude Desktop E2E verification** ??? **Completed 2026-03-22** (Run [1]). See [`docs/e2e-run-log.md`](./e2e-run-log.md).
- [x] **T12** ??? **SIS cookies in auth** ??? Extend `src/auth/server.ts` to visit SIS URLs before saving session. **Completed 2026-03-22**.
- [x] **T13** ? README and user-facing onboarding (iterate as features land).

---

### 2.3 Tracker ??? engine beta: Intelligence (T14-T20)

Execute **in order**; do not skip inspect/research tasks.

- [x] **T14** ??? **SIS Inspection** ??? Created `scripts/inspect-sis.ts`, analyzed HTML structure for exams and timetable selection. **Completed 2026-03-22**.
- [x] **T15** ??? **SIS Scraper** ??? Implemented `src/scraper/sis.ts` with `scrapeExams` and `scrapeTimetable` logic. Handles session selection. **Completed 2026-03-22**.
- [x] **T16** ??? **SIS Tools** ??? Registered `get_exam_schedule` and `get_class_timetable` in `src/index.ts`. **Completed 2026-03-22**.
- [x] **T17** ? Add `scripts/inspect-rmp.ts`: resolve York school ID via RMP GraphQL; confirm `Authorization` token.
- [x] **T18** ? Implement `src/tools/rmp.ts`, register `search_professors` and `get_professor_details`, `TTL.PROFESSOR`.
- [x] **T19** ? README + `PROJECT_MASTER` + tool table: **13 tools**, SIS cookie troubleshooting, example prompts.
- [x] **T20** ? **E2E engine beta**: four new tools verified in Claude Desktop (SIS x2 + RMP x2). **Completed 2026-03-23**; see [`docs/t11-e2e-handbook.md`](./t11-e2e-handbook.md).

---

### 2.4 Tracker ??? engine polish / post-beta (T21-T31)

Optional parallel work (does not block T14-T20). **Write tools (T28-T31)** are future engine work and are gated by **E20** (see [?2.13](#213-detailed-plan--v12-write-tools--safety-t28-t31)).

#### 2.4.1 Automation, scraper, cache (T21-T27)

- [ ] **T21** ??? **Cron / proactive deadline notifications** (`node-cron`, notifier, `src/notifications/cron.ts`).
- [x] **T22** ??? PDF pipeline: intelligent diagram / image detection and payload strategy ? [`get_file_text/roadmap.md`](tools/get_file_text/roadmap.md). **Completed 2026-03-23**.
- [x] **T23** ? Deadlines: harden quiz + date selectors across themes; document test courses. **Completed 2026-03-23**.
- [x] **T24** ? Richer `get_grades` / `get_announcements` / course map (post-v1 excellence per [?6](#6-mvp-vs-post-v1--perfection-backlog)). **Completed 2026-03-23**.
- [x] **T25** ? **Scraper modularization:** break up `src/scraper/eclass.ts` into `src/scraper/eclass/` (browser session, domain modules, thin fa?ade) ? **no functional regressions**; see [?2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown).
- [ ] **T26** ? **Smart cache:** fresher TTL tiers, **`fetched_at` / `expires_at` / `cache_hit`** on tool JSON, **`clear_cache`** MCP tool (scoped), **volatile cache clear on successful auth**, replace ad-hoc `_v2`/`_v3` key suffixes with **`CACHE_SCHEMA_VERSION`** ? [?2.11](#211-detailed-plan--t27-smart-cache-metadata--clear_cache-tool).
- [ ] **T27** ? **Pinned cache (user-directed):** structured pin/unpin/list/refresh, single-store discipline vs TTL cache, on-disk **quota** with machine-readable "full" errors ? [?2.12](#212-detailed-plan--t28-user-pinned-cache-quota-and-tools). **Depends on T26.**

#### 2.4.2 Future write tools (T28-T31)

**Prerequisites:** **E20** satisfied before registering or implementing destructive tools; **E11** / **E12** are part of E20. **E21** must land **with** the first write tool merge (same PR or immediately after). **E13** (session at-rest hardening) is **strongly recommended** before relying on writes on shared machines.

- [ ] **T28** ? **Assignment submission preflight:** scraper + MCP tool(s) to resolve an assignment activity (from course/URL/cm id), return **read-only** constraints (due date, allowed types/size, draft vs final, current submission summary). No upload. Supports human-in-the-loop workflows.
- [ ] **T29** ? **`submit_assignment` (working name):** Playwright flow: upload file(s) / text per Moodle UI, final submit. **Required:** Zod input includes explicit **`confirm: true`**; tool registered **only** when opt-in env is set (see **E20**). Depends on **T28** for validation path reuse.
- [ ] **T30** ? **`add_calendar_event` (working name):** narrow scope first (e.g. **personal** calendar events the UI allows for the student role); same **confirm** + env gate as T29. Inspect script + selectors before implementation.
- [ ] **T31** ? **E2E future writes:** extend [`docs/t11-e2e-handbook.md`](./t11-e2e-handbook.md) + [`docs/e2e-run-log.md`](./e2e-run-log.md) for **T28-T30** (preflight, submit, calendar); include session-expired and **writes disabled** (env off) cases.

---

### 2.5 Tracker ? engineering gap to 9+ (E01-E21)

| ID | Item | Epic |
| --- | --- | --- |
| [x] **E01** | CI workflow: push + PR, `npm ci`, `npm run build`, `npx tsc --noEmit` | A |
| [x] **E02** | Add `npm run lint` + `npm run test` to CI when available | A |
| [x] **E03** | ESLint + TypeScript-eslint + Prettier; scripts `lint`, `lint:fix`, `format`, `format:check` | A |
| [x] **E04** | Add `LICENSE` (verify SPDX matches `package.json`) | A |
| [x] **E05** | Add `SECURITY.md` (reporting contact, scope, safe harbor) | A |
| [x] **E06** | Add `CONTRIBUTING.md` + optional `CODE_OF_CONDUCT.md` | A |
| [x] **E07** | Branch rename `master` ? `main` (Decision: kept `master`) | A |
| [x] **E08** | Test framework (Vitest/Jest) + coverage script | B |
| [x] **E09** | Unit tests: cache TTL, session helpers, pure parsers | B |
| [ ] **E10** | HTML fixtures + integration tests for scrape helpers (?6 variants) | B |
| [ ] **E11** | Zod schemas for tool outputs (and inputs where missing); stable JSON envelope (**required** for write tools via **E20**) | B |
| [ ] **E12** | Structured error types + machine codes (`SESSION_EXPIRED`, `SCRAPE_LAYOUT_CHANGED`, ?) (**required** for write tools via **E20**) | B |
| [ ] **E13** | Session at-rest hardening + secure wipe on logout | C |
| [ ] **E14** | Structured logging + correlation ID + redaction | C |
| [ ] **E15** | Selector registry + drift diagnostics; optional debug snapshot mode | C |
| [ ] **E16** | `npm run doctor` (Node, Playwright, Claude config path, `.env`, permissions) | D |
| [ ] **E17** | Setup script `--dry-run` + backup/restore for merged Claude config | D |
| [ ] **E18** | `CHANGELOG.md` + tagging / GitHub Release template | D |
| [ ] **E19** | Document timeouts, concurrency, rate limits for external calls | D |
| [ ] **E20** | **Write tools ? pre-ship gates:** **E11** + **E12** complete for every write tool; `SECURITY.md` + README subsection (risks, misuse, no warranty); **opt-in env** (e.g. `ECLASS_MCP_ENABLE_WRITES=1`) ? write tools **not registered** when unset; link to [?2.13](#213-detailed-plan--v12-write-tools--safety-t28-t31) | C |
| [ ] **E21** | **Write tools ? post-write hygiene:** append-only **local audit log** (action, resource ids, outcome, timestamp; **no** secrets or file bytes; redact paths per **E14**); **invalidate** volatile cache keys affected by a successful write (deadlines, item details, grades, content as applicable; align with **T26** when present) | C |

*(E01?E07 = Epic A, E08?E12 = B, E13?E15 = C, E16?E19 = D; **E20?E21** = write-tool safety, Epic C.)*

---

### 2.6 Detailed plan ? **T11** Formal E2E testing (Claude Desktop)

**Goal:** Validate the real Claude Desktop host end-to-end and capture a reusable manual run record. The exact operator flow lives in [`docs/t11-e2e-handbook.md`](./t11-e2e-handbook.md).

**Minimum scope:** all 10 tool rows, the session-expiry regression, redacted evidence in [`docs/e2e-run-log.md`](./e2e-run-log.md), and a clean `npx tsc --noEmit` at the tested commit.

**Definition of done:** the handbook run was completed as written, every row is marked Pass/Fail/Skip with reasons, and every Fail has an issue number in the run log.

**Future automation:** a fixture-backed headless MCP client test may be added later for CI, but it does not replace the Claude Desktop manual pass.

---

### 2.7 Detailed plan ??? **T12** SIS cookies in auth (Immediate Foundation)

**Goal:** Extend `src/auth/server.ts` to navigate to SIS URLs during the visible login flow so Playwright captures the necessary cookies for future SIS-based tools.

#### Steps

1. Identify post-login redirect triggers in `auth/server.ts`.
2. Insert navigation loop to `w2prod.sis.yorku.ca` URLs (see [?10.3](#103-architecture-deltas-engine-beta-specific)).
3. Verify `session.json` now contains `w2prod.sis.yorku.ca` host entries.
4. Update `SessionExpiredError` text if users need specific instructions for the new cookies.

---

### 2.8 Detailed plan — **T14-T20** (engine beta intelligence) procedure

#### T14: inspect-sis

1. Implement script per engine beta spec; output HTML + console probe to `.eclass-mcp/debug/`.
2. Document: final URL after redirect, login vs data page, table counts.

#### T15: sis scraper

1. Implement parsers for Exam Schedule and Timetable.
2. Add `scripts/test-sis.ts`; print sample rows.

#### T16: sis tools

1. Register `get_exam_schedule` + `get_class_timetable`.
2. Ensure `loadSession()` correctly propagates SIS cookies.

#### T17: inspect-rmp

1. Run GraphQL school search; record York `schoolID`.
2. Probe professor search headers/tokens.

#### T18: RMP tool

1. Implement `searchRMP`; cache by normalized name key.
2. Register tool + schema.

#### T19: Docs

1. README tools table 13 rows.
2. Update executive snapshot tool counts.

**T20 ??? E2E engine beta**

Full verification of the 4 new tools (SIS x2, RMP x2) in Claude Desktop. **Completed 2026-03-23**.

---

### 2.9 Detailed plan ??? **T21** Cron notifications (engine post-beta automation)

**Goal:** Optional morning reminder of deadlines in the next **48 hours**, via desktop notification.

1. Install `node-notifier`.
2. Implement `src/notifications/cron.ts` using `node-cron`.
3. Reuse `getDeadlines` logic (filter to 48h).
4. Wire to `src/index.ts` avoiding stdio pollution.
5. Add `DEADLINE_CRON=1` opt-in flag.

---

### 2.10 Detailed plan ??? **E01-E21** engineering (9+), including CI/CD

#### 2.9.1 E01?E02 ? Continuous Integration (GitHub Actions)

**Objective:** Every PR and every push to the default branch proves the repo **installs and compiles**.

**Steps**

1. Create **`.github/workflows/ci.yml`**:

```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  build:
    timeout-minutes: 15
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node-version: [20.x, 22.x]

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test
```

1. **Why `npm ci`:** reproducible installs from lockfile; fails if lock out of sync.
2. **`npm run build`** runs `tsc` (typecheck + emit); a separate `tsc --noEmit` step is optional and was omitted to avoid duplicate compiler work.
3. **Why Node matrix:** catches platform-specific path or optional dependency issues (Windows vs Linux).
4. **Playwright in CI:** only add `npx playwright install chromium` to CI when **automated browser tests** exist (E10); otherwise skip to keep CI fast.
5. **Branch protection (manual):** In GitHub ? Settings ? Branches, require **CI pass** before merge to `master`.
6. **Badge (optional):** Add workflow status badge to README after first green run.
7. **`timeout-minutes: 15`** on the job avoids hung installs (e.g. future Playwright in CI).

**E01 done when:** workflow is green on a test PR for all matrix cells or documented exclusions.

**E02 done when:** `lint` and `test` steps are present and required; job fails if either fails.

#### 2.9.2 E03: Lint and format

1. `npm install -D eslint @eslint/js typescript-eslint prettier eslint-config-prettier`.
2. Add `eslint.config.js` (flat config) with TypeScript project service for `src/**/*.ts`.
3. Add `.prettierrc` (minimal: semi, singleQuote, trailingComma ? match existing code).
4. `package.json` scripts:

```json
"lint": "eslint src --max-warnings 0",
"lint:fix": "eslint src --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

1. Run `lint:fix` + `format` once; commit baseline; tighten `max-warnings` over time.

#### 2.9.3 E04?E07 ? Governance

- **E04 LICENSE:** Choose ISC/MIT/etc., match `package.json` `"license"`.
- **E05 SECURITY.md:** Include how to report vulnerabilities, supported versions, and that session files are local-sensitive.
- **E06 CONTRIBUTING:** PR flow, `npm ci`, `tsc`, how to run E2E checklist.
- **E07 branch naming:** Renaming to `main` was considered; decision reached to stay on `master` for this repository. All references updated to explicitly use `master`. (Completed)`.

#### 2.9.4 E08?E12 ? Tests and contracts

- **E08:** Add Vitest (or Jest); `npm test`; CI invocation with `--run` for non-interactive.
- **E09:** First unit tests: `cache/store` expiry math, `session` stale logic, parser helpers with small buffers.
- **E10:** Check in **sanitized HTML fixtures** under `tests/fixtures/`; tests run cheerio/jsdom or direct helper functions ? **no** live eClass in CI.
- **E11:** Define zod schemas for tool return payloads; validate in dev or behind flag before responding.
- **E12:** Central `AppError` hierarchy with `code` field; map `SessionExpiredError` to `SESSION_EXPIRED`; tools return consistent JSON error shape.

#### 2.9.5 E13?E15 ? Security and operations

- **E13:** Encrypt `session.json` or OS keychain storage; document threat model (local disk, shared machine).
- **E14:** `pino` or similar; child logger per tool invocation with `requestId`; redact cookie substrings.
- **E15:** Config object for selector arrays per page type; log which selector won; on total failure throw coded `SCRAPE_LAYOUT_CHANGED`.

#### 2.9.6 E16?E19 ? Productization

- **E16 `doctor`:** Node ?18, `fs.access` on Claude config dir, `which` chromium or playwright cache path, `.env` keys present.
- **E17 setup:** Parse-merge Claude JSON with backup `*.bak` timestamp; `--dry-run` prints diff only.
- **E18 releases:** Keep a `CHANGELOG.md` (Keep a Changelog format); tag `vX.Y.Z`; GitHub Release body = changelog section.
- **E19:** Document default timeouts per `page.goto`; max concurrent pages; backoff for RMP if HTTP 429.

#### 2.9.7 E20?E21 ? Future write-tool safety

- **E20:** Pre-ship **gates** for **T28-T30**: **E11** + **E12** done for write tools; opt-in env for registration; README + `SECURITY.md` copy. Full checklist: [?2.13](#213-detailed-plan--v12-write-tools--safety-t28-t31).
- **E21:** **After** a successful write: append-only **audit log** (redaction aligned with **E14**); **invalidate** scrape cache entries that would otherwise lie (scopes per **T26** / `clear_cache` once available).

---

### 2.10 Detailed plan ? **T25** Scraper modularization (`eclass.ts` breakdown)

**Goal:** `src/scraper/eclass.ts` is too large to navigate and test. Refactor into **small modules** under `src/scraper/eclass/` while preserving **identical public API** for `src/tools/*` (either keep a thin `eclass.ts` at `src/scraper/` that re-exports, or update imports once in a single PR ? prefer **one barrel** so downstream stays `from '../scraper/eclass'`).

**Current status:** the modular split has been implemented in code, the barrel/API surface is preserved, and the post-refactor regression E2E in `T25.9` has passed.

**T25 sub-task summary:**

- Baseline inventory: map the old monolith before moving code.
- Shared helpers: extract pure parsing and shaping helpers first.
- Browser/session: isolate Playwright browser/context ownership.
- Feature slices: split courses, deadlines, item details, grades, announcements, files, and sections.
- Barrel cleanup: keep `scraper` and `SessionExpiredError` stable for callers.
- Regression E2E: prove the split did not change behavior or tool shapes.

#### Principles

- **Behavior first:** no selector or flow changes in the same PR as file moves; move code, then follow-up PRs for fixes.
- **Single browser singleton:** one class (e.g. `EClassScraper`) owns `browser`, `getBrowser()`, `getAuthenticatedContext()`, `dumpPage()` — not duplicated across files.
- **Domain modules** export methods that take `(ctx helpers)` or are class mixins/partial classes only if TypeScript stays clear; simplest pattern is **one class in `index.ts` or `EClassScraper.ts`** that **delegates** to plain functions in feature files.

#### Suggested layout — (adjust names to taste; match existing method groupings in the file)

| Module | Responsibility |
|--------|------------------|
| `eclass/constants.ts` | `ECLASS_URL`, shared timeouts if any |
| `eclass/types.ts` or re-exports | Types/interfaces currently colocated in `eclass.ts` (or keep importing from a `types` file if already split) |
| `eclass/browser-session.ts` | `getBrowser`, `getAuthenticatedContext`, `dumpPage`, WAF/init-script concerns |
| `eclass/helpers.ts` | Pure helpers: `normalizeWhitespace`, `extractCourseCode`, `buildCourseMetadata`, `inferItemType`, `toDeadlineItem`, etc. |
| `eclass/courses.ts` | `getCourses`, `getCourseContent` |
| `eclass/deadlines.ts` | `getDeadlines`, `getMonthDeadlines`, assignment-index paths, `getAllAssignmentDeadlines`, ? |
| `eclass/item-details.ts` | `getItemDetails`, `getAssignmentDetails`, `getQuizDetails` |
| `eclass/grades.ts` | `getGrades` |
| `eclass/announcements.ts` | `getAnnouncements` |
| `eclass/files.ts` | `downloadFile` |
| `eclass/sections.ts` | `getSectionText` |
| `eclass/EClassScraper.ts` | Class composing the above (or `index.ts` assembling the class) |
| `eclass.ts` (at `scraper/`) | **Barrel:** `export { scraper, SessionExpiredError, ? types ? } from './eclass'` so tools unchanged |

**Execution steps**

1. Create `src/scraper/eclass/` and move **helpers + constants** first; run `npx tsc --noEmit`.
2. Extract **browser-session**; wire class to use it; run typecheck.
3. Extract **one vertical slice** (e.g. `getCourses` only) end-to-end to validate the pattern; run `npx ts-node scripts/test-scraper.ts` or equivalent smoke.
4. Repeat for **deadlines**, **item-details**, **grades**, **announcements**, **files**, **sections**, **course content** in separate commits or one commit per area (user preference).
5. Ensure **`SessionExpiredError`** and **`export const scraper`** remain the stable public surface.
6. **Definition of done for T25**
   - [x] No remaining duplicate logic; `eclass.ts` at repo root of scraper is only re-exports + singleton (or documented new entry).
   - [x] `npm run build` and `npx tsc --noEmit` clean.
   - [x] Smoke: `list_courses`, one `get_deadlines` scope, one `get_item_details` URL (manual or script).
   - [x] Optional follow-up: unit tests per module (pairs well with **E08?E10**).

---

### 2.11 Detailed plan ? **T26** Smart cache, metadata, `clear_cache` tool

#### Design review (agreements and pushback)

- **Agree:** TTL should differ by **volatility** (announcements/deadlines vs course outline vs expensive file parse). Users deserve to know **when** data was fetched.
- **Pushback ? ?hit eClass on login or whenever user calls the tool??:** Hitting eClass on **every** tool call removes most cache benefit and increases ban/WAF risk. Prefer: **(1)** shorter TTLs for hot data, **(2)** **clear volatile cache after successful auth** (new session ? stale assumptions), **(3)** optional **`force_refresh`** on selected tools, **(4)** explicit **`clear_cache`** when the user asks for the freshest data.
- **Pushback ? ?syllabus vs announcements?? without signals:** The cache layer does not reliably know if a PDF is a syllabus or a lecture; same URL can be overwritten. **Phase 1 of T26:** tier by **tool/resource type** (not filename NLP). **Phase 2 (optional later):** shorter TTL when `get_file_text` detects "outline" patterns or user flags ? out of scope for T26 DoD unless time allows.
- **Metadata in responses:** Add a **small, stable envelope** to the JSON each tool already returns (e.g. top-level `_cache: { hit, fetched_at, expires_at }` plus existing payload fields) so Claude can quote freshness. Avoid a **second** MCP content block for every call (noisier protocol-wise); the model can summarize `_cache` in natural language for the user.
- **`clear_cache` tool:** **Agree** ? register a **10th** tool `clear_cache` with `scope`: `all` \| `volatile` \| `deadlines` \| `announcements` \| `grades` \| `content` \| `files` \| `courses` (exact enum to match key prefixes). Return a short JSON summary of what was removed.
- **"Cache-first" discipline:** Tools must check for a valid, unexpired cache **before** triggering a session check or login flow. If valid cache exists, return it instantly; only force login if cache is missing or expired.

#### Target TTLs (minutes) ? replace current `TTL` in `store.ts`

| Tier | Tools / keys | Minutes | Rationale |
| --- | --- | --- | --- |
| **Hot** | Deadlines (`get_deadlines`, `get_upcoming_deadlines`), announcements | **30** | Instructor posts and due dates change often. |
| **Warm** | `get_item_details` | **20** | Submission status / visible grades change after student actions. |
| **Course shell** | `get_course_content`, `get_section_text` | **180** (3h) | Section lists change occasionally; fresher than old 6h is enough without hammering. |
| **Enrollment** | `list_courses` | **360** (6h) | Add/drop is rare mid-week; half old 24h default. |
| **Grades** | `get_grades` | **180** (3h) | Between "live" and old 12h. |
| **Parsed files** | `get_file_text` | **2880** (48h) | Parsing is expensive; same URL can be replaced ? 48h balances speed vs staleness (was 7d). *Team may keep 7d if bandwidth is the bottleneck ? document choice in PR.* |

*Tune after dogfooding; values are defaults, not physics.*

#### T26 Sub-tasks

- [x] **T26.1: Core store refactor (`src/cache/store.ts`)**
  - [x] Update `CacheEntry` interface to include `fetched_at: string` (ISO8601).
  - [x] Implement `CACHE_SCHEMA_VERSION` constants and update `getCacheKey` logic.
  - [x] Add `clearByPrefix(prefix: string)` and `clearVolatile()` methods.
- [x] **T26.2: Metadata Envelope & Helpers**
  - [x] Create `attachCacheMeta` helper to inject the `_cache` field into responses.
  - [x] Update `store.get` to return `fetched_at` and `expires_at` alongside data.
- [x] **T26.3: Auth-Cache Integration**
  - [x] Trigger `cache.clearVolatile()` in `src/auth/server.ts` upon session save.
- [x] **T26.4: Tool Migration (Tiered TTLs)**
  - [x] Update `list_courses`, `get_deadlines`, `get_item_details`, `get_grades`, `get_announcements` with new TTLs.
  - [x] Ensure all 10+ core tools return the `_cache` metadata.
- [x] **T26.5: `clear_cache` Tool Implementation**
  - [x] Implement `src/tools/cache.ts` and register in `src/index.ts`.
  - [x] Define the `scope` enum representing different cache tiers/prefixes.
- [x] **T26.6: Cleanup & Docs**
  - [x] Remove legacy `_vN` key suffixes from tool code.
  - [x] Update `README.md` tool table and explain `_cache` freshness fields.
- [x] **T26.7: E2E Verification & User Tests**
  - [x] **Test 1: Metadata Transparency.** Call `list_courses` once. Verify JSON contains `_cache` hit: false. Call again immediately, verify hit: true.
  - [x] **Test 2: Granular Scope Clear.** Call `get_item_details`. Verify cache hit. Call `clear_cache(scope="content")`. Call `get_item_details` again. Verify it is now a miss (hit: false).
  - [x] **Test 3: Volatile Clear on Auth.** Call `get_deadlines`. Verify hit. Perform a new authentication at `/auth`. Call `get_deadlines` again. Verify it was cleared and is now a miss.
  - [x] **Test 4: Cross-tool Cache Consistency.** Verify that related tools (e.g., `get_deadlines` and `get_upcoming_deadlines`) share the same cache prefix (`deadlines_`) and invalidate together.

#### Definition of done (T26)

- [x] All T26 sub-tasks marked `[x]`.
- [x] `npm run build` is clean.
- [x] E2E check shows `list_courses` and `get_deadlines` returning `_cache` metadata.
- [x] Successful auth clears deadlines/grades cache automatically.
- [x] Manual `clear_cache` verified for at least one specific scope.

---

### 2.12 Detailed plan ? **T27** User-pinned cache, quota, and tools

**Intent:** Let a user (via natural language ? model-invoked tools) **retain** specific eClass resources across TTL expiry so heavy paths (e.g. parsed files) are not refetched from scratch **without** treating chat as the source of truth.

**Prerequisite:** Land **T26** first (`CACHE_SCHEMA_VERSION`, `_cache` metadata envelope, `clear_cache`, volatile clear on auth). T27 layers **policy and tools** on top of a coherent cache story; designing it before T26 risks two divergent persistence models.

#### Problem framing (why "just say pin this lecture" is insufficient)

- **Stable identity:** Pins must be keyed on **structured IDs** the scraper already understands (course id, resource/mod URL, `cmid` where applicable, etc.). Natural language is only **intent**; the assistant must call tools with **explicit parameters**. Wrong keys ? wrong cache hits (worse than a miss).
- **Same URL, new bytes:** eClass can replace a file at an **unchanged URL**. A pin is an **assume-immutability** snapshot unless refreshed. Product copy and tool responses should expose **`pinned_at`** / last fetch metadata (aligned with T26 `_cache` or a sibling `_pin` field) so staleness is visible.
- **Not a second copy of the world:** Prefer **one on-disk store** where a pin is **metadata + pointer** into the same blob the normal file cache uses (or a single record with "pinned ? exempt from TTL eviction?"), rather than duplicating parsed text under a parallel "mini DB."

#### Proposed surface (names indicative)

Register **small, explicit MCP tools** (exact names TBD in implementation):

| Tool | Role |
|------|------|
| `cache_pin` | Mark a resource as pinned; persists registry entry + ensures payload retained per quota rules. |
| `cache_unpin` | Remove pin; underlying cache entry may revert to normal TTL eviction unless otherwise referenced. |
| `cache_list_pins` | List pinned keys + labels + sizes + `pinned_at` (for user and model). |
| `cache_refresh_pin` | Optional but **recommended**: refetch from eClass, update content/hash, keep pin. |

*Alternative:* one `manage_cache` tool with a `mode` enum; trade-off is fewer registered tools vs. noisier schemas.

#### Pin record (minimum fields)

- **`resource_type`** ? e.g. `file` \| `section` \| *(only types we can key reliably; start narrow)*  
- **Stable resource key** ? tuple agreed per type (e.g. `courseId` + canonical file URL, not "lecture 3" titles alone)  
- **`pinned_at`** (ISO8601)  
- **Optional `note`** ? short user/agent label  
- **Optional integrity hints** ? `etag`, `Last-Modified`, or **content hash** from last successful fetch (helps detect silent URL replacement when refresh is run)

#### Quota and ?storage full???

- **Configurable limits:** e.g. global **`max_pin_bytes`** (and optionally **`max_single_object_bytes`**) under `.eclass-mcp/` config or env; defaults documented in README.
- **What counts:** Define explicitly: raw downloaded bytes, parsed text / JSON cache entries, and pin-registry overhead?**one accounting model**, documented.
- **On exceed:** Return **structured JSON** (e.g. `ok: false`, `reason: "quota_exceeded"`, `used_bytes`, `limit_bytes`, `would_use_bytes`, optional `largest_pins`). The MCP host does not guarantee a GUI prompt; the **model** explains the failure to the user?so payloads must be **precise** to avoid hallucinated remediation.
- **Policy choice (document in PR):** hard **reject** new pins when full vs. **evict unpinned cache first** vs. **LRU among pins**?pick one default; hard reject is simplest but can deadlock until user unpins.

#### Interaction with T26

- **`clear_cache`:** Specify whether scopes like `all` or `files` **remove pinned content** or pins **survive** until `cache_unpin` / dedicated scope (e.g. `pins`). Users will expect predictable rules; document in README and tool descriptions.
- **Auth / volatile clear:** Decide if successful login clears **pin registry** (unlikely) vs. only **volatile** keys (likely)?pins probably **survive** session refresh but **refresh_pin** may be required if cookies rotated and fetches fail.

#### Risks called out (non-goals unless expanded)

- **Credentials:** Pin registry and payloads must **never** store session secrets; same discipline as today's cache.
- **Privacy:** Longer retention of extracted text increases local exposure if device is shared?same as "longer TTL," but more explicit.
- **Scope creep:** Pinning "whole course" bundles is tempting but ambiguous; **ship narrow** (e.g. files first), extend later.

#### Documentation

- README: pin semantics ("immutable until refresh"), quota env vars, interaction with `clear_cache`.
- Update **?3.1** tool count and planned rows when T27 ships.

#### Definition of done (T27)

- [ ] **T26 complete** (or explicitly listed exceptions documented)?no parallel cache key story.
- [ ] Pin registry on disk + integration with **single** cache architecture (no duplicate blobs for the same logical file without justification).
- [ ] `cache_pin` / `cache_unpin` / `cache_list_pins` (+ `cache_refresh_pin` or documented equivalent).
- [ ] Quota enforcement + **structured** over-quota errors (bytes used/limit/would-use).
- [ ] Responses include freshness/pin metadata consistent with T26 style where applicable.
- [ ] README + **?3.1** updated; `clear_cache` + auth behavior w.r.t. pins documented.

---

### 2.13 Detailed plan ? **future write tools + safety (T28-T31, E20-E21)**

**Goal:** Add **opt-in** MCP tools that **mutate** eClass state (assignment submission, personal calendar), without turning the default install into an autonomous submission bot.

#### Safety before implementation (E20)

1. **Contracts:** Complete **E11** (Zod) and **E12** (structured errors) for **all** write tools before merge. Machine-readable failures beat prose when the host retries or summarizes.
2. **Registration gate:** `ListTools` / `index.ts` registers write tools **only** when an explicit env var is set (name **`ECLASS_MCP_ENABLE_WRITES`** unless renamed in implementation; document in `.env.example`).
3. **User-facing risk:** README subsection + **SECURITY.md** bullet: writes are **irreversible** in normal use; users are responsible for confirming paths and course context; no institutional warranty.
4. **Session posture:** Treat **E13** as a **recommended** prerequisite for write tools on laptops that are not single-user private.

#### Product shape (T28-T30)

- **Preflight first (T28):** A read-only tool (or extension of existing detail fetch) that returns **constraints** and **current submission state** so the model and user can sanity-check before any upload.
- **Submit (T29):** One tool, narrow parameters (course/activity identity + local file path or agreed payload shape), mandatory **`confirm: true`**, strict MIME/size checks against preflight when feasible.
- **Calendar (T30):** Start with events the **student role** can create in Moodle; same confirm + env gate. Expand scope only after inspect script proves permissions.

#### Safety after a successful write (E21)

1. **Audit log:** Append one JSON line per write under `.eclass-mcp/` (exact filename in implementation); fields: `tool`, `outcome`, `timestamp`, stable resource ids; **never** log cookies, full filesystem paths (basename only unless user opts into verbose diagnostics).
2. **Cache coherence:** After success, **invalidate** scraped cache entries that would otherwise show stale submission or deadline state (prefixes aligned with **T26** / `clear_cache` scopes once those exist).

#### Verification (T31)

- Extend the E2E handbook with **safe** scenarios (test course / sandbox if available); document **Skip** when no fixture course.
- Rows for: preflight happy path, submit with writes **disabled** (env off), session expired mid-flow.

#### Definition of done (writes track)

- [ ] **E20** checkboxes satisfied; write tools absent from default registration.
- [ ] **E21** audit + invalidation behavior documented in README.
- [ ] **T28-T30** implemented with shared validation helpers.
- [ ] **T31** handbook + run log updated (or explicit Skip with reason).

---

## 3. Executive snapshot

### 3.1 MCP tools currently registered (13)

| Tool | Purpose |
|------|---------|
| `list_courses` | Enrolled courses |
| `get_course_content` | Sections, files, links, activities for one course |
| `get_section_text` | Paragraph text, links, and tabbed content for a section URL |
| `get_file_text` | PDF / DOCX / PPTX extraction (hybrid text + rendered pages where applicable) |
| `get_upcoming_deadlines` | Assignments due within N days (default 14) |
| `get_deadlines` | Deadlines by scope: `upcoming` \| `month` \| `range` |
| `get_item_details` | Deep fetch for one assignment/quiz URL (optional vision images, CSV inlining) |
| `get_grades` | Grade report |
| `get_announcements` | Recent announcements |
| `get_exam_schedule` | Personal exam schedule (SIS) |
| `get_class_timetable` | Personal class timetable (SIS) |
| `search_professors` | RateMyProfessors profile search |
| `get_professor_details` | RateMyProfessors deep ratings, comments, and student tags |

**Planned ([T26](#211-detailed-plan--t27-smart-cache-metadata--clear_cache-tool)):** `clear_cache` ? user-requested invalidation; all tools gain JSON **`_cache`** freshness metadata.

**Planned ([T27](#212-detailed-plan--t28-user-pinned-cache-quota-and-tools)):** optional **`cache_pin` / `cache_unpin` / `cache_list_pins` / `cache_refresh_pin`** (or equivalent)?user-directed long retention with **on-disk quota** and structured errors when full. **After T26.**

**Planned future writes ([T28-T31](#213-detailed-plan--future-write-tools--safety-t28-t31), gated by **E20-E21** in ?2.5):** **`submit_assignment`** and **`add_calendar_event`** (working names), plus **assignment preflight**; **opt-in env**; **`confirm: true`** on destructive calls; **not** registered unless enabled.

**Source of truth:** [`src/index.ts`](../src/index.ts).

### 3.2 Technology and runtime (canonical)

- **Language / runtime:** TypeScript on Node.js (? 18).
- **MCP:** `@modelcontextprotocol/sdk`, stdio transport to the host (e.g. Claude Desktop).
- **Scraping:** Playwright (Chromium); **auth** flow uses a **visible** browser; **data** scraping uses **headless** contexts with session cookies.
- **Parsers:** PDF (including pdfjs-based pipeline where implemented), DOCX (mammoth), PPTX (ZIP/XML extraction).
- **Persistence:** no database; JSON on disk under **`.eclass-mcp/`** (gitignored): `session.json`, `cache/`, optional `debug/`.
- **Config:** `.env` (gitignored), `.env.example` for template.

### 3.3 Auth and session (canonical)

- Local HTTP server (default port from env, e.g. `AUTH_PORT=3000`) exposes routes such as **`/auth`** for interactive login and **`/status`** for session validity.
- Successful login persists **all** Playwright cookies for the context to **`.eclass-mcp/session.json`** via `saveSession()`; headless scrapers use `loadSession()` and `SessionExpiredError` when missing/expired/stale.
- **Server logging:** use **`console.error`** for diagnostics ? **stdout** is reserved for MCP protocol traffic.

---

## 4. Architecture reference (single source of truth)

### 4.1 Layout (evolved from v1 plan)

Key paths under `src/`:

- `index.ts` ? MCP server, tool registration  
- `tools/*.ts` ? one module per tool area  
- `scraper/session.ts` ? load/save cookies, validity  
- `scraper/eclass.ts` ? main eClass scraper (large; modularize under **T25** / [?2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown))  
- `auth/server.ts` ? local auth HTTP server  
- `cache/store.ts` ? TTL JSON cache  
- `parser/*` ? file parsing  

### 4.2 Tool error pattern (canonical)

Authenticated tools should catch `SessionExpiredError`, prompt re-auth (e.g. `openAuthWindow()` where implemented), and return a text response the model can surface to the user. Public HTTP tools (future RMP) omit session handling and propagate or wrap other errors as appropriate.

```typescript
// Pattern (representative ? align with existing tools in src/tools/)
try {
  // ... fetch / scrape ...
} catch (e) {
  if (e instanceof SessionExpiredError) {
    openAuthWindow();
    return { content: [{ type: 'text' as const, text: (e as Error).message }] };
  }
  throw e;
}
```

### 4.3 Cache keys

**Current code** still uses ad-hoc `_v2` / `_v3` suffixes in some tools. **Target (T26):** a single **`CACHE_SCHEMA_VERSION`** in [`src/cache/store.ts`](../src/cache/store.ts) plus key builders ? bump only when the **JSON shape** of cached data changes; see [?2.11](#211-detailed-plan--t27-smart-cache-metadata--clear_cache-tool).

---

## 5. Working with AI agents on this repo

Consolidated from the original v1 and v2 agent instruction blocks (one copy only):

1. Prefer **one focused task** at a time; report what changed and any errors before assuming the next task.  
2. Do **not** skip **research/inspect** tasks before writing selectors or external API calls (SIS WebObjects, RMP GraphQL, etc.).  
3. After substantive TypeScript changes, run **`npx tsc --noEmit`** (and project scripts as applicable).  
4. Do **not** modify unrelated tools or scrapers unless the task explicitly requires it.  
5. Respect feature-area docs under `docs/tools/*/` when editing that area.  

Tool-specific "rules for agent" (e.g. deadlines) also appear in [`docs/tools/deadlines/roadmap.md`](tools/deadlines/roadmap.md).

---

## 6. MVP vs post-v1 / "perfection" backlog

The legacy **CoYork TODO** mixed **accurate deferred work** with **checkboxes that undersell what already shipped**.

### 6.1 CoYork TODO ? active pipelines (preserved intent)

| Area | Status | Notes |
|------|--------|--------|
| PDF: pdfjs-style page intelligence, payload tuning | **Completed** | Baseline shipped in `get_file_text`; see [`get_file_text/history.md`](tools/get_file_text/history.md) and [`get_file_text/roadmap.md`](tools/get_file_text/roadmap.md) for the completed baseline plus future refinements. |
| Deadlines: Moodle 4 upcoming + month + range + item details | **Shipped** | See [?8](#8-shipped-feature-history-deadlines--file-pipeline). |
| Ops: `npx playwright install chromium` on each machine | **Open** | Environment prerequisite, not optional for scraping. |
| Harden quiz + month/date selectors across themes | **Open** | Quality beyond first ship. |

### 6.2 "Upcoming tools" section ? reinterpretation

The unchecked items **Grades**, **Announcements**, **Course scraper**, **Enhanced sessions** are **misleading as "not built"**: baseline **`get_grades`**, **`get_announcements`**, **`list_courses`**, **`get_course_content`**, **`get_section_text`** exist.

Treat them as **post-v1 excellence**, not greenfield:

| TODO line (legacy) | Shipped baseline | Deferred / perfection |
|--------------------|------------------|------------------------|
| Grades tool | `get_grades` | Richer feedback columns, edge course layouts, structured normalization |
| Announcements | `get_announcements` | Richer parsing, forum threads, attachments |
| Course scraper | `get_course_content`, `get_section_text` | Deeper maps, clubs/complex sections, consistency across themes |
| Enhanced sessions | Auth + `session.json` | First-class 2FA/session refresh UX, optional encryption (see **E13** in [?2.5](#25-tracker--engineering-gap-to-9-e01-e19)) |

---

## 7. Original v1 build plan (historical summary)

**Source:** former `eclass-mcp-implementation-plan.md`.  

**Checkbox status** for T01?T13: see [?2.2](#22-tracker--v1-foundation-t01t13).

The original spec targeted **6 tools**; the repo now ships **13**. Optional follow-ons mentioned there (RMP, subreddit, multi-user, hosted server) are superseded by **T14?T20** and engineering track **E\***.

---

## 8. Shipped feature history (deadlines & file pipeline)

**Deduplication:** full narratives remain in the linked files; this section is an index + milestones.

### 8.1 Deadlines & details

**Docs:** [`docs/tools/deadlines/history.md`](tools/deadlines/history.md), [`roadmap.md`](tools/deadlines/roadmap.md), optional [`failed-prompts-investigation-plan.md`](tools/deadlines/failed-prompts-investigation-plan.md), [`vision-image-reading.md`](tools/deadlines/vision-image-reading.md).

**Milestones completed (summary):**

- Phase 0: Moove / Moodle 4 selector fixes, `parseEClassDate`, upcoming-only behavior.  
- Phase 1: `get_deadlines` scopes + month scraping + `get_item_details` + optional `includeDetails` / `maxDetails` + details TTL cache.  
- Phase 2: Month/range backed by **assignment index** (`mod/assign/index.php`) + date boundaries + enriched rows (`section`, `submission`, `grade`).  
- Phase 3: Vision instruction images + CSV inlining on `get_item_details`.  
- Phase 4: `courseName` / `courseCode` on deadline items + cache key bumps.  

### 8.2 File / PDF pipeline

**Docs:** [`docs/tools/get_file_text/history.md`](tools/get_file_text/history.md), [`roadmap.md`](tools/get_file_text/roadmap.md).  

**Current direction (implemented):** pdfjs + `@napi-rs/canvas`, text-density heuristic (~250 chars), DPI/payload caps, hybrid text + PNG output, paginated fetches. **T22 is complete**; the roadmap now tracks only future refinements beyond the shipped baseline.

---

## 9. Phase A ? Active product backlog (themes)

For **checkbox execution**, use [?2](#2-master-execution-tracker--detailed-implementation-plans): engine beta **T14-T20**, post-beta **T21-T31**, engineering **E01-E21**, and tool roadmaps:

1. **PDF / files** ? [`get_file_text/roadmap.md`](tools/get_file_text/roadmap.md).  
2. **Deadlines** ? Playwright install; selector hardening; [`deadlines/roadmap.md`](tools/deadlines/roadmap.md).  
3. **Post-v1 tool depth** ? [?6.2](#62-upcoming-tools-section--reinterpretation).  
4. **Scraper structure** ? **T25** / [?2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown).  
5. **Cache / freshness (automatic)** ? **T26** / [?2.11](#211-detailed-plan--t27-smart-cache-metadata--clear_cache-tool).  
6. **User-pinned cache + quota** ? **T27** / [?2.12](#212-detailed-plan--t28-user-pinned-cache-quota-and-tools) *(after T26)*.  
7. **future write tools (opt-in)** ? **T28-T31** + **E20-E21** / [?2.13](#213-detailed-plan--future-write-tools--safety-t28-t31) *(after E11/E12; E13 recommended)*.  

---

## 10. Phase B ? Engine beta: external data (SIS, RMP)

**Prerequisite:** patterns in [?4](#4-architecture-reference-single-source-of-truth). **Execution:** [?2.3](#23-tracker--engine-beta-intelligence-t14-t20) + [?2.8](#28-detailed-plan--t14-t20-engine-beta-intelligence-procedure).

### 10.1 New tools (planned)

| Tool | Source | Auth | Method |
|------|--------|------|--------|
| `get_exam_schedule` | York SIS `w2prod.sis.yorku.ca` | Yes (SSO; cookies after auth) | Playwright |
| `get_class_timetable` | Same | Yes | Playwright |
| `search_professors` | RateMyProfessors | No | `fetch` + GraphQL |
| `get_professor_details` | RateMyProfessors | No | `fetch` + GraphQL |

### 10.2 Architecture deltas (engine-beta-specific)

- **SIS cookies:** After eClass dashboard (and existing WAF/resource touch if present), navigate **SIS URLs once** before `context.cookies()` so `session.json` includes `w2prod.sis.yorku.ca`. Users with old sessions **re-authenticate** once.  
- **`session.ts`:** No change required if all cookies are saved; Playwright scopes cookies by domain.  
- **`src/scraper/sis.ts`:** New module ? **do not** put SIS scraping in `eclass.ts`.  
- **RMP:** Node **`fetch` only**; no new HTTP libraries.  
- **TTL additions** (merge into `TTL` in `store.ts` when implementing):

```typescript
EXAM_SCHEDULE: 60 * 24,     // 24 hours
TIMETABLE: 60 * 24,         // 24 hours
PROFESSOR: 60 * 24 * 7,     // 7 days
```

### 10.3 SIS auth extension (illustrative snippet)

After the existing post-login `page.goto` to `${ECLASS_URL}/mod/resource/view.php` (errors ignored), loop:

```typescript
const SIS_URLS = [
  'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/wa/DirectAction/cde',
  'https://w2prod.sis.yorku.ca/Apps/WebObjects/cdm.woa/3/wo/ZxNcUb9vXro0FrVqevTtkw/0.3.10.7.2.0',
];
for (const sisUrl of SIS_URLS) {
  try {
    await page.goto(sisUrl, { timeout: 15000, waitUntil: 'networkidle' });
  } catch { /* timeouts OK ? cookie acquisition is the goal */ }
}
```

### 10.4 Final tool matrix after engine beta

| # | Tool | Source | Auth |
|---|------|--------|------|
| 1?9 | *(current eClass tools)* | eClass | Yes |
| 10 | `get_exam_schedule` | SIS | Yes (SSO) |
| 11 | `get_class_timetable` | SIS | Yes (SSO) |
| 12 | `search_professors` | RMP | No |
| 13 | `get_professor_details` | RMP | No |

---

## 11. Phase C ? Engineering excellence reference (gap to 9.0+)

**Full procedural steps:** **?2.5** (tracker **E01-E21**) and [?2.9](#29-detailed-plan--e01-e19-engineering-9-including-cicd); write-tool gates **E20-E21** in [?2.13](#213-detailed-plan--future-write-tools--safety-t28-t31) and **?2.9.7**.

### 11.1 Executive summary

The project scores roughly **7.4/10** on engineering maturity; largest gaps are **CI/CD, tests, security hardening, structured errors, observability, and release discipline**.

### 11.2 Scored rubric (0?10)

| Category | Python ref | This repo | Notes |
|----------|------------|-----------|-------|
| Architecture clarity | 8.0 | 7.5 | TS repo more complex |
| Feature depth | 4.0 | 8.5 | TS much broader |
| Reliability/resilience | 5.5 | 7.0 | Selector fallbacks help |
| Security posture | 5.5 | 6.0 | Session hardening TBD |
| Testing maturity | 4.5 | 4.5 | Needs CI + fixtures |
| DevEx/onboarding | 7.0 | 8.5 | Strong practical docs |
| Portability | 6.5 | 6.0 | Env assumptions |
| Documentation | 8.0 | 8.0 | Good troubleshooting |
| Professional polish | 7.0 | 7.0 | Needs formal guardrails |
| Production readiness | 5.5 | 7.0 | Closer to daily use |

### 11.3 SWOR, definition of 9+, KPIs, risks, sprints

- **SWOR:** strengths = York value, modular tools, Playwright realism; weaknesses = quality gates, drift, session security; opportunities = fixtures, doctor, releases; risks = untested scope growth, silent breakage, leaks.  
- **9.0+ means:** reliable, CI-tested, secure-enough local session, operable errors/logs, lifecycle docs, portable setup.  
- **KPIs:** CI pass rate, regression detection in one PR cycle, >70% critical-path coverage, zero cookie leaks in logs.  
- **Three-sprint sketch:** Sprint 1 = E01?E07 + start E08; Sprint 2 = E08?E12 + early E14; Sprint 3 = E13?E15 + E16?E19; **write tools:** land **E20-E21** with **T28-T31** when E11/E12 are green.  

### 11.4 Score projection (after roadmap)

| Category | Current | Target |
|----------|---------|--------|
| Architecture | 7.5 | 8.8 |
| Features | 8.5 | 9.2 |
| Reliability | 7.0 | 9.0 |
| Security | 6.0 | 8.6 |
| Testing | 4.5 | 8.5 |
| DevEx | 8.5 | 9.2 |
| Portability | 6.0 | 8.7 |
| Docs | 8.0 | 9.0 |
| Polish | 7.0 | 9.1 |
| Production readiness | 7.0 | 9.0 |

---

## 12. Phase D ? Maintainer / codebase health

- **T25 ? `src/scraper/eclass.ts` refactor:** Tracked in **?2.4**; full procedure in [?2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown).  
- **T28-T31 future writes:** **?2.4.2** + [?2.13](#213-detailed-plan--future-write-tools--safety-t28-t31); gates **E20-E21** in **?2.5**.  
- **Align docs** when tool counts or auth flows change (README + ?2 trackers).

---

## Appendix A ? Documentation map

| Topic | Path |
|-------|------|
| **This master plan** | `docs/PROJECT_MASTER.md` |
| Engine versioning policy | `docs/PROJECT_MASTER.md#engine-versioning--release-policy` |
| Tool-by-tool docs index (13 tools) | `docs/tools/README.md` |
| T11 / T20 ? Claude Desktop E2E procedure | `docs/t11-e2e-handbook.md` |
| E2E run log (create when running T11) | `docs/e2e-run-log.md` |
| Deadlines tool ? roadmap & testing | `docs/tools/deadlines/roadmap.md` |
| Deadlines ? history | `docs/tools/deadlines/history.md` |
| File / PDF ? history & roadmap | `docs/tools/get_file_text/history.md`, `roadmap.md` |
| User-facing README | `README.md` |

---

## Appendix B ? Scripts directory policy

- **Keep:** `setup.mjs`, `setup-claude.sh`, `tsconfig.json`, and the small set listed in [`scripts/README.md`](../scripts/README.md) (`test-scraper`, deadlines/month/item-details, `test-pdf-parser`, `debug-file-url`).  
- **Remove from git or move to gitignored `scripts/output/`:** Captured dumps ? `*.txt`, `*.json`, `.html` that are probe outputs.  
- **Optional:** `scripts/archive/` for one-off investigations + [`scripts/README.md`](../scripts/README.md).  

---

## Appendix C: Superseded root documents (removed)

The following were deleted from the repo root; use this file instead:

- `TODO.md` ? `eclass-mcp-implementation-plan.md` ? `mcp v2.md` ? `review.md`

---

*End of project master document.*
