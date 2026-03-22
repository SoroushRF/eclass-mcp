# eClass MCP — Project master document

**Canonical planning and history for the eClass MCP repository.**  
**Last updated:** 2026-03-22  

This file subsumes the former root docs (CoYork TODO, v1 implementation plan, v1.1 SIS/RMP/Reddit plan, gap-to-9+ review), which were **removed** from the repo root in favor of this single source of truth.

---

## Table of contents

1. [How to use this document](#1-how-to-use-this-document)
2. [**Master execution tracker & detailed implementation plans**](#2-master-execution-tracker--detailed-implementation-plans) ← **start here for what’s left to build**
3. [Executive snapshot](#3-executive-snapshot)
4. [Architecture reference](#4-architecture-reference-single-source-of-truth)
5. [Working with AI agents on this repo](#5-working-with-ai-agents-on-this-repo)
6. [MVP vs post-v1 / “perfection” backlog](#6-mvp-vs-post-v1--perfection-backlog)
7. [Original v1 build plan (historical summary)](#7-original-v1-build-plan-historical-summary)
8. [Shipped feature history (deadlines & file pipeline)](#8-shipped-feature-history-deadlines--file-pipeline)
9. [Phase A — Active product backlog (themes)](#9-phase-a--active-product-backlog-themes)
10. [Phase B — Product v2: external data (SIS, RMP, Reddit)](#10-phase-b--product-v2-external-data-sis-rmp-reddit)
11. [Phase C — Engineering excellence reference (gap to 9.0+)](#11-phase-c--engineering-excellence-reference-gap-to-90)
12. [Phase D — Maintainer / codebase health](#12-phase-d--maintainer--codebase-health)
13. [Appendix A — Documentation map](#appendix-a--documentation-map)
14. [Appendix B — Scripts directory policy](#appendix-b--scripts-directory-policy)
15. [Appendix C — Legacy source files (pending removal)](#appendix-c--legacy-source-files-pending-removal)

---

## 1. How to use this document

- **User setup and features:** start with the repo [`README.md`](../README.md).
- **What to build next:** use [§2](#2-master-execution-tracker--detailed-implementation-plans) — unified checkboxes, serial task IDs, and **step-by-step** plans for everything not done (E2E, v1.1 SIS/RMP/Reddit, **T26** `eclass.ts` modularization, 9+ engineering).
- **Deep dives:** deadlines and PDF pipeline live under [`docs/tools/deadlines/`](tools/deadlines/) and [`docs/tools/get_file_text/`](tools/get_file_text/).
- **Deduplication:** stack, session paths, and tool lists appear once in [§3](#3-executive-snapshot) and [§4](#4-architecture-reference-single-source-of-truth).

---

## 2. Master execution tracker & detailed implementation plans

This section is the **standing implementation plan**: one serial numbering scheme, **checkboxes per task**, and **thick procedural detail** for incomplete work (especially **E2E** and **9+ / CI**).

### 2.1 Task ID legend

| Range | Origin |
|-------|--------|
| **T01–T13** | Original v1 implementation plan (`eclass-mcp-implementation-plan.md`) |
| **T14–T22** | v1.1 extension — SIS, RateMyProfessors, Reddit (`mcp v2.md`), **nine** tasks in strict order |
| **T23-T25** | Optional product polish (parallel track; does not block T14-T22) |
| **T26** | Maintainer: split [`src/scraper/eclass.ts`](../src/scraper/eclass.ts) into `src/scraper/eclass/` — [§2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown) |
| **E01-E19** | Engineering “gap to 9+” work items (mapped from former `review.md` epics A-D) |

Status: `[x]` done in repo today · `[ ]` not done / not verified to standard.

---

### 2.2 Tracker — v1 foundation (T01-T13)

- [x] **T01** — Project scaffolding (`package.json`, `tsconfig`, `.gitignore`, `.env.example`, `src/` skeleton, `npm` scripts, `.eclass-mcp/` dirs).
- [x] **T02** — Cache store (`src/cache/store.ts`, TTL constants, get/set/invalidate/clear).
- [x] **T03** — Session layer (`src/scraper/session.ts`, save/load/validity/clear, stale window).
- [x] **T04** — Auth HTTP server (`src/auth/server.ts`, `/auth`, `/status`, visible browser for login).
- [x] **T05** — eClass scraper core (`src/scraper/eclass.ts`, `SessionExpiredError`, real scraping APIs; evolved well beyond original mock stage).
- [x] **T06** — File parsers (`src/parser/pdf.ts`, `docx.ts`, `pptx.ts`; PDF path later upgraded — see file-tool docs).
- [x] **T07** — MCP tool modules (`src/tools/*.ts`, cache + session error handling).
- [x] **T08** — MCP server entry (`src/index.ts`, stdio transport, tool registration — **9 tools** today vs original 6).
- [x] **T09** — Claude Desktop setup helper (`scripts/setup-claude.sh`, `npm run setup` pattern).
- [x] **T10** — Real York eClass selectors and scraper hardening (ongoing refinement; baseline **done**).
- [ ] **T11** — **Formal Claude Desktop E2E verification** — scripted matrix below; **not** completed to documentation standard.
- [ ] **T12** — **Cron / proactive deadline notifications** (`node-cron`, notifier, `src/notifications/cron.ts`) — **not implemented** in `src/`.
- [x] **T13** — README and user-facing onboarding (iterate as features land).

---

### 2.3 Tracker — product v1.1 (T14-T22)

Execute **in order**; do not skip inspect/research tasks.

- [ ] **T14** — Extend `src/auth/server.ts` to visit SIS URLs before `context.cookies()` so `session.json` includes `w2prod.sis.yorku.ca`; users re-auth once after deploy.
- [ ] **T15** — Add `scripts/inspect-sis.ts`: load session, headless navigate exam + timetable URLs, dump HTML + structure probe to `.eclass-mcp/debug/`; **no production scrape code** until findings reviewed.
- [ ] **T16** — Implement `src/scraper/sis.ts` (`getExamSchedule`, `getTimetable`) from T15 findings (WebObjects: forms, hidden fields, fragile URLs).
- [ ] **T17** — Add `src/tools/sis.ts`, register `get_exam_schedule` + `get_timetable` in `index.ts`, add `TTL.EXAM_SCHEDULE` / `TTL.TIMETABLE`, versioned cache keys.
- [ ] **T18** — Add `scripts/inspect-rmp.ts`: resolve York school ID via RMP GraphQL; confirm `Authorization` token; document results.
- [ ] **T19** — Implement `src/tools/rmp.ts`, register `get_professor_rating`, `TTL.PROFESSOR`, cache keys `rmp_v1_*`.
- [ ] **T20** — Implement `src/tools/reddit.ts` (`fetch`, User-Agent, r/yorku search), register `search_york_reddit`, `TTL.REDDIT`.
- [ ] **T21** — README + `PROJECT_MASTER` + tool table: **13 tools**, SIS cookie troubleshooting, example prompts.
- [ ] **T22** — **E2E v1.1**: four new tools verified in Claude Desktop (prompts in §2.7.3).

---

### 2.4 Tracker — product polish stream (T23-T26)

Optional parallel work (does not block T14-T22). **T26** is maintainer/refactor work, not a user-facing feature.

- [ ] **T23** — PDF pipeline: intelligent diagram / image detection and payload strategy — [`get_file_text/roadmap.md`](tools/get_file_text/roadmap.md).
- [ ] **T24** — Deadlines: harden quiz + date selectors across themes; document test courses.
- [ ] **T25** — Richer `get_grades` / `get_announcements` / course map (post-v1 excellence per [§6](#6-mvp-vs-post-v1--perfection-backlog)).
- [ ] **T26** — **Scraper modularization:** break up `src/scraper/eclass.ts` into `src/scraper/eclass/` (browser session, domain modules, thin façade) — **no functional regressions**; see [§2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown).

---

### 2.5 Tracker — engineering gap to 9+ (E01-E19)

| ID | Item | Epic |
|----|------|------|
| [ ] **E01** | CI workflow: push + PR, `npm ci`, `npm run build`, `npx tsc --noEmit` | A |
| [ ] **E02** | Add `npm run lint` + `npm run test` to CI when available | A |
| [ ] **E03** | ESLint + TypeScript-eslint + Prettier; scripts `lint`, `lint:fix`, `format`, `format:check` | A |
| [ ] **E04** | Add `LICENSE` (verify SPDX matches `package.json`) | A |
| [ ] **E05** | Add `SECURITY.md` (reporting contact, scope, safe harbor) | A |
| [ ] **E06** | Add `CONTRIBUTING.md` + optional `CODE_OF_CONDUCT.md` | A |
| [ ] **E07** | Branch rename `master` → `main` (or document decision) + update refs | A |
| [ ] **E08** | Test framework (Vitest/Jest) + coverage script | B |
| [ ] **E09** | Unit tests: cache TTL, session helpers, pure parsers | B |
| [ ] **E10** | HTML fixtures + integration tests for scrape helpers (≥6 variants) | B |
| [ ] **E11** | Zod schemas for tool outputs (and inputs where missing); stable JSON envelope | B |
| [ ] **E12** | Structured error types + machine codes (`SESSION_EXPIRED`, `SCRAPE_LAYOUT_CHANGED`, …) | B |
| [ ] **E13** | Session at-rest hardening + secure wipe on logout | C |
| [ ] **E14** | Structured logging + correlation ID + redaction | C |
| [ ] **E15** | Selector registry + drift diagnostics; optional debug snapshot mode | C |
| [ ] **E16** | `npm run doctor` (Node, Playwright, Claude config path, `.env`, permissions) | D |
| [ ] **E17** | Setup script `--dry-run` + backup/restore for merged Claude config | D |
| [ ] **E18** | `CHANGELOG.md` + tagging / GitHub Release template | D |
| [ ] **E19** | Document timeouts, concurrency, rate limits for external calls | D |

*(E01–E07 = Epic A, E08–E12 = B, E13–E15 = C, E16–E19 = D.)*

---

### 2.6 Detailed plan — **T11** Formal E2E testing (Claude Desktop)

**Goal:** Prove each MCP tool works **end-to-end** through the **real** host (Claude Desktop), with **recorded evidence** suitable for regression after releases.

#### 2.6.1 Preconditions (must all pass before testing)

1. **Versions recorded** in a small log (date, OS build, Node `node -v`, Claude Desktop version, this repo `git rev-parse HEAD`).
2. **`npm run build`** succeeds; `npx tsc --noEmit` clean.
3. **Playwright browser:** `npx playwright install chromium` completed on this machine.
4. **Claude config** points `eclass` server at **`dist/index.js`** (or documented equivalent), path is absolute and valid.
5. **Session:** `GET http://localhost:<AUTH_PORT>/status` returns authenticated after visiting `/auth` and completing login (including any MFA).
6. **Clean cache (optional but recommended for one full pass):** delete `.eclass-mcp/cache/*` if you need to validate cold paths (slower).

#### 2.6.2 How to observe tool use

- In Claude Desktop, open the **tools / hammer** UI and confirm **eclass** tools list matches [§3.1](#31-mcp-tools-currently-registered-9).
- For each test, note whether Claude **invoked the correct tool** (tool name) and whether the **returned payload** was structurally sane (JSON text blocks parseable; images only where expected).

#### 2.6.3 Core tool matrix (minimum acceptance)

Run each row; record **Pass / Fail / Skip** + one-line notes.

| # | Suggested user prompt (natural language) | Expected tool(s) | Structural checks |
|---|----------------------------------------|------------------|-------------------|
| 1 | “What courses am I enrolled in?” | `list_courses` | Non-empty array; entries have `id`, `name`, `url` |
| 2 | “List sections and files for course &lt;ID&gt;” (paste real ID) | `get_course_content` | `sections` array; items have `type`, `name`, `url` |
| 3 | “Open this section URL and summarize the text: &lt;section URL&gt;” | `get_section_text` | `title`, `mainText` or `tabs` populated |
| 4 | “Read this file: &lt;fileUrl from content&gt;” | `get_file_text` | Text and/or image blocks; within size limits |
| 5 | “What’s due in the next two weeks?” | `get_upcoming_deadlines` | Items with `dueDate`, `url`, course labels where available |
| 6 | “What deadlines are in March 2026?” (adjust) | `get_deadlines` | `scope=month` behavior; dated items |
| 7 | “Assignments due between … and …” | `get_deadlines` | `scope=range`; boundaries respected |
| 8 | “Get full details for this assignment URL …” | `get_item_details` | JSON with `kind`, instructions or `fields`; optional images/CSV per args |
| 9 | “What are my grades?” | `get_grades` | Rows with item names + grades |
| 10 | “Recent announcements” | `get_announcements` | Entries with title, date, body text |

#### 2.6.4 Session expiry regression

1. **Stop** the MCP server if needed; delete `.eclass-mcp/session.json` (or use invalid session file).
2. Restart server; invoke any eClass tool via Claude.
3. **Expect:** user-visible message to re-authenticate + `http://localhost:<port>/auth` (wording may vary slightly).
4. Re-auth; repeat **one** smoke tool (e.g. `list_courses`) → **Pass** if data returns.

#### 2.6.5 Definition of done for T11

- [ ] All **10** core rows executed with **Pass** or documented **Skip** with reason (e.g. no PDF in courses).
- [ ] Session expiry row **Pass**.
- [ ] Results captured in **`docs/e2e-run-log.md`** (create on first run): date, commit, environment, table copy with outcomes.
- [ ] Any failure filed as an issue with **tool name**, **prompt**, and **redacted** response snippet.

#### 2.6.6 Future automation (optional, post-E08)

- Add a **headless MCP client** test using `@modelcontextprotocol/sdk` client transport against a **fixture** server or mocked scraper — **not** a substitute for T11 host validation but good for CI.

---

### 2.7 Detailed plan — **T12** Cron notifications

**Goal:** Optional morning (or scheduled) reminder of deadlines in the next **48 hours**, via desktop notification + optional JSON file.

#### 2.7.1 Dependencies

- `node-cron` (already in original plan deps; verify `package.json`).
- `node-notifier` + types — add if implementing.

#### 2.7.2 Implementation sketch

1. Create **`src/notifications/cron.ts`** exporting `startDeadlineCron()`:
   - Schedule `0 8 * * *` (08:00 local) or env-configurable cron string.
   - Call existing scraper path used by tools (reuse `scraper.getDeadlines` / shared function — avoid duplicating HTTP).
   - Filter to due within **48 hours** (same semantics as original plan).
2. If any matches: build short string list; call `node-notifier`; write `.eclass-mcp/notifications.json` (shape documented in code).
3. Wire from `src/index.ts` **after** MCP transport connected — ensure cron does **not** write to stdout (use `console.error` only if needed).

#### 2.7.3 Safety & UX

- **Opt-in env flag** e.g. `DEADLINE_CRON=1` default off until user enables.
- **Failure isolation:** cron errors must not crash MCP process (try/catch, log to stderr).
- **Privacy:** notification text should list **titles + courses**, not internal URLs, if displayed on shared screens.

#### 2.7.4 Verification

- Temporarily set cron to `* * * * *` for **one** minute in dev; confirm single fire; revert.
- Confirm no MCP stdio pollution.

#### 2.7.5 Definition of done for T12

- [ ] Code merged behind env flag; documented in README.
- [ ] Manual test note in `docs/e2e-run-log.md` or tool doc.

---

### 2.8 Detailed plan — **T14–T22** (v1.1) procedure

**T14 — SIS cookies in auth**

1. Locate post-login WAF/resource navigation in `auth/server.ts`.
2. Insert SIS URL loop (see [§10.3](#103-architecture-deltas-v2-specific) for URLs); swallow navigation errors.
3. Save session; grep `session.json` for `w2prod.sis.yorku.ca`.
4. `npx tsc --noEmit`; manual re-auth test.

**T15 — inspect-sis**

1. Implement script per v1.1 spec; output HTML + console probe.
2. Document: final URL after redirect, login vs data page, table counts, whether semester selection is required.

**T16 — sis scraper**

1. Implement parsers only from T15 facts; handle WebObjects forms if required.
2. Add `scripts/test-sis.ts`; print sample rows.

**T17 — sis tools**

1. Mirror other tools: cache, `SessionExpiredError`, `openAuthWindow`.
2. Register tools; update TTL in `store.ts`.

**T18 — inspect-rmp**

1. Run GraphQL school search; record York `schoolID`.
2. Probe professor search; note if `Authorization: Basic dGVzdDp0ZXN0` still valid — if 401, capture current token from browser DevTools and update plan + code.

**T19 — RMP tool**

1. Implement `searchRMP`; cache by normalized name key.
2. Register tool + schema.

**T20 — Reddit tool**

1. Implement search with `User-Agent: eclass-mcp/1.0 (…)`; cap `limit` ≤ 25.
2. Register tool + schema.

**T21 — Docs**

1. README tools table 13 rows; troubleshooting for SIS cookies.
2. Update this file’s executive snapshot tool count when merged.

**T22 — E2E v1.1**

| Prompt | Tool |
|--------|------|
| “When are my final exams?” | `get_exam_schedule` |
| “Show my class timetable this semester” | `get_timetable` |
| “RateMyProfessors for Prof. …” | `get_professor_rating` |
| “What does r/yorku say about …” | `search_york_reddit` |

Record outcomes in `docs/e2e-run-log.md`.

---

### 2.9 Detailed plan — **E01–E19** engineering (9+), including CI/CD

#### 2.9.1 E01–E02 — Continuous Integration (GitHub Actions)

**Objective:** Every PR and every push to the default branch proves the repo **installs and compiles**.

**Steps**

1. Create **`.github/workflows/ci.yml`**:

```yaml
name: CI
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  build:
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

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Build
        run: npm run build

      # Uncomment when E03/E08 land:
      # - name: Lint
      #   run: npm run lint
      # - name: Test
      #   run: npm test -- --run
```

2. **Why `npm ci`:** reproducible installs from lockfile; fails if lock out of sync.
3. **Why Node matrix:** catches platform-specific path or optional dependency issues (Windows vs Linux).
4. **Playwright in CI:** only add `npx playwright install chromium` to CI when **automated browser tests** exist (E10); otherwise skip to keep CI fast.
5. **Branch protection (manual):** In GitHub → Settings → Branches, require **CI pass** before merge to `main`/`master`.
6. **Badge (optional):** Add workflow status badge to README after first green run.

**E01 done when:** workflow is green on a test PR for all matrix cells or documented exclusions.

**E02 done when:** `lint` and `test` steps are present and required; job fails if either fails.

#### 2.9.2 E03 — Lint and format

1. `npm install -D eslint @eslint/js typescript-eslint prettier eslint-config-prettier`.
2. Add `eslint.config.js` (flat config) with TypeScript project service for `src/**/*.ts`.
3. Add `.prettierrc` (minimal: semi, singleQuote, trailingComma — match existing code).
4. `package.json` scripts:

```json
"lint": "eslint src --max-warnings 0",
"lint:fix": "eslint src --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

5. Run `lint:fix` + `format` once; commit baseline; tighten `max-warnings` over time.

#### 2.9.3 E04–E07 — Governance

- **E04 LICENSE:** Choose ISC/MIT/etc., match `package.json` `"license"`.
- **E05 SECURITY.md:** Include how to report vulnerabilities, supported versions, and that session files are local-sensitive.
- **E06 CONTRIBUTING:** PR flow, `npm ci`, `tsc`, how to run E2E checklist.
- **E07 main branch:** Rename + update any docs/scripts referencing `master`.

#### 2.9.4 E08–E12 — Tests and contracts

- **E08:** Add Vitest (or Jest); `npm test`; CI invocation with `--run` for non-interactive.
- **E09:** First unit tests: `cache/store` expiry math, `session` stale logic, parser helpers with small buffers.
- **E10:** Check in **sanitized HTML fixtures** under `tests/fixtures/`; tests run cheerio/jsdom or direct helper functions — **no** live eClass in CI.
- **E11:** Define zod schemas for tool return payloads; validate in dev or behind flag before responding.
- **E12:** Central `AppError` hierarchy with `code` field; map `SessionExpiredError` to `SESSION_EXPIRED`; tools return consistent JSON error shape.

#### 2.9.5 E13–E15 — Security and operations

- **E13:** Encrypt `session.json` or OS keychain storage; document threat model (local disk, shared machine).
- **E14:** `pino` or similar; child logger per tool invocation with `requestId`; redact cookie substrings.
- **E15:** Config object for selector arrays per page type; log which selector won; on total failure throw coded `SCRAPE_LAYOUT_CHANGED`.

#### 2.9.6 E16–E19 — Productization

- **E16 `doctor`:** Node ≥18, `fs.access` on Claude config dir, `which` chromium or playwright cache path, `.env` keys present.
- **E17 setup:** Parse-merge Claude JSON with backup `*.bak` timestamp; `--dry-run` prints diff only.
- **E18 releases:** Keep a `CHANGELOG.md` (Keep a Changelog format); tag `vX.Y.Z`; GitHub Release body = changelog section.
- **E19:** Document default timeouts per `page.goto`; max concurrent pages; backoff for Reddit/RMP if HTTP 429.

---

### 2.10 Detailed plan — **T26** Scraper modularization (`eclass.ts` breakdown)

**Goal:** `src/scraper/eclass.ts` is too large to navigate and test. Refactor into **small modules** under `src/scraper/eclass/` while preserving **identical public API** for `src/tools/*` (either keep a thin `eclass.ts` at `src/scraper/` that re-exports, or update imports once in a single PR — prefer **one barrel** so downstream stays `from '../scraper/eclass'`).

**Principles**

- **Behavior first:** no selector or flow changes in the same PR as file moves; move code, then follow-up PRs for fixes.
- **Single browser singleton:** one class (e.g. `EClassScraper`) owns `browser`, `getBrowser()`, `getAuthenticatedContext()`, `dumpPage()` — not duplicated across files.
- **Domain modules** export methods that take `(ctx helpers)` or are class mixins/partial classes only if TypeScript stays clear; simplest pattern is **one class in `index.ts` or `EClassScraper.ts`** that **delegates** to plain functions in feature files.

**Suggested layout** (adjust names to taste; match existing method groupings in the file)

| Module | Responsibility |
|--------|------------------|
| `eclass/constants.ts` | `ECLASS_URL`, shared timeouts if any |
| `eclass/types.ts` or re-exports | Types/interfaces currently colocated in `eclass.ts` (or keep importing from a `types` file if already split) |
| `eclass/browser-session.ts` | `getBrowser`, `getAuthenticatedContext`, `dumpPage`, WAF/init-script concerns |
| `eclass/helpers.ts` | Pure helpers: `normalizeWhitespace`, `extractCourseCode`, `buildCourseMetadata`, `inferItemType`, `toDeadlineItem`, etc. |
| `eclass/courses.ts` | `getCourses`, `getCourseContent` |
| `eclass/deadlines.ts` | `getDeadlines`, `getMonthDeadlines`, assignment-index paths, `getAllAssignmentDeadlines`, … |
| `eclass/item-details.ts` | `getItemDetails`, `getAssignmentDetails`, `getQuizDetails` |
| `eclass/grades.ts` | `getGrades` |
| `eclass/announcements.ts` | `getAnnouncements` |
| `eclass/files.ts` | `downloadFile` |
| `eclass/sections.ts` | `getSectionText` |
| `eclass/EClassScraper.ts` | Class composing the above (or `index.ts` assembling the class) |
| `eclass.ts` (at `scraper/`) | **Barrel:** `export { scraper, SessionExpiredError, … types … } from './eclass'` so tools unchanged |

**Execution steps**

1. Create `src/scraper/eclass/` and move **helpers + constants** first; run `npx tsc --noEmit`.
2. Extract **browser-session**; wire class to use it; run typecheck.
3. Extract **one vertical slice** (e.g. `getCourses` only) end-to-end to validate the pattern; run `npx ts-node scripts/test-scraper.ts` or equivalent smoke.
4. Repeat for **deadlines**, **item-details**, **grades**, **announcements**, **files**, **sections**, **course content** in separate commits or one commit per area (user preference).
5. Ensure **`SessionExpiredError`** and **`export const scraper`** remain the stable public surface.
6. **Definition of done for T26**
   - [ ] No remaining duplicate logic; `eclass.ts` at repo root of scraper is only re-exports + singleton (or documented new entry).
   - [ ] `npm run build` and `npx tsc --noEmit` clean.
   - [ ] Smoke: `list_courses`, one `get_deadlines` scope, one `get_item_details` URL (manual or script).
   - [ ] Optional follow-up: unit tests per module (pairs well with **E08–E10**).

---

## 3. Executive snapshot

### 3.1 MCP tools currently registered (9)

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

**Source of truth:** [`src/index.ts`](../src/index.ts).

### 3.2 Technology and runtime (canonical)

- **Language / runtime:** TypeScript on Node.js (≥ 18).
- **MCP:** `@modelcontextprotocol/sdk`, stdio transport to the host (e.g. Claude Desktop).
- **Scraping:** Playwright (Chromium); **auth** flow uses a **visible** browser; **data** scraping uses **headless** contexts with session cookies.
- **Parsers:** PDF (including pdfjs-based pipeline where implemented), DOCX (mammoth), PPTX (ZIP/XML extraction).
- **Persistence:** no database; JSON on disk under **`.eclass-mcp/`** (gitignored): `session.json`, `cache/`, optional `debug/`.
- **Config:** `.env` (gitignored), `.env.example` for template.

### 3.3 Auth and session (canonical)

- Local HTTP server (default port from env, e.g. `AUTH_PORT=3000`) exposes routes such as **`/auth`** for interactive login and **`/status`** for session validity.
- Successful login persists **all** Playwright cookies for the context to **`.eclass-mcp/session.json`** via `saveSession()`; headless scrapers use `loadSession()` and `SessionExpiredError` when missing/expired/stale.
- **Server logging:** use **`console.error`** for diagnostics — **stdout** is reserved for MCP protocol traffic.

---

## 4. Architecture reference (single source of truth)

### 4.1 Layout (evolved from v1 plan)

Key paths under `src/`:

- `index.ts` — MCP server, tool registration  
- `tools/*.ts` — one module per tool area  
- `scraper/session.ts` — load/save cookies, validity  
- `scraper/eclass.ts` — main eClass scraper (large; modularize under **T26** / [§2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown))  
- `auth/server.ts` — local auth HTTP server  
- `cache/store.ts` — TTL JSON cache  
- `parser/*` — file parsing  

### 4.2 Tool error pattern (canonical)

Authenticated tools should catch `SessionExpiredError`, prompt re-auth (e.g. `openAuthWindow()` where implemented), and return a text response the model can surface to the user. Public HTTP tools (future RMP/Reddit) omit session handling and propagate or wrap other errors as appropriate.

```typescript
// Pattern (representative — align with existing tools in src/tools/)
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

Version suffixes on cache keys (e.g. `_v2`, `_v3`) are used so scraper or schema changes do not serve stale structured data. New features should follow the same convention.

---

## 5. Working with AI agents on this repo

Consolidated from the original v1 and v2 agent instruction blocks (one copy only):

1. Prefer **one focused task** at a time; report what changed and any errors before assuming the next task.  
2. Do **not** skip **research/inspect** tasks before writing selectors or external API calls (SIS WebObjects, RMP GraphQL, etc.).  
3. After substantive TypeScript changes, run **`npx tsc --noEmit`** (and project scripts as applicable).  
4. Do **not** modify unrelated tools or scrapers unless the task explicitly requires it.  
5. Respect feature-area docs under `docs/tools/…` when editing that area.  

Tool-specific “rules for agent” (e.g. deadlines) also appear in [`docs/tools/deadlines/roadmap.md`](tools/deadlines/roadmap.md).

---

## 6. MVP vs post-v1 / “perfection” backlog

The legacy **CoYork TODO** mixed **accurate deferred work** with **checkboxes that undersell what already shipped**.

### 6.1 CoYork TODO — active pipelines (preserved intent)

| Area | Status | Notes |
|------|--------|--------|
| PDF: pdfjs-style page intelligence, payload tuning | **Open** | Deferred past MVP; see [`get_file_text/roadmap.md`](tools/get_file_text/roadmap.md). |
| Deadlines: Moodle 4 upcoming + month + range + item details | **Shipped** | See [§8](#8-shipped-feature-history-deadlines--file-pipeline). |
| Ops: `npx playwright install chromium` on each machine | **Open** | Environment prerequisite, not optional for scraping. |
| Harden quiz + month/date selectors across themes | **Open** | Quality beyond first ship. |

### 6.2 “Upcoming tools” section — reinterpretation

The unchecked items **Grades**, **Announcements**, **Course scraper**, **Enhanced sessions** are **misleading as “not built”**: baseline **`get_grades`**, **`get_announcements`**, **`list_courses`**, **`get_course_content`**, **`get_section_text`** exist.

Treat them as **post-v1 excellence**, not greenfield:

| TODO line (legacy) | Shipped baseline | Deferred / perfection |
|--------------------|------------------|------------------------|
| Grades tool | `get_grades` | Richer feedback columns, edge course layouts, structured normalization |
| Announcements | `get_announcements` | Richer parsing, forum threads, attachments |
| Course scraper | `get_course_content`, `get_section_text` | Deeper maps, clubs/complex sections, consistency across themes |
| Enhanced sessions | Auth + `session.json` | First-class 2FA/session refresh UX, optional encryption (see **E13** in [§2.5](#25-tracker--engineering-gap-to-9-e01-e19)) |

---

## 7. Original v1 build plan (historical summary)

**Source:** former `eclass-mcp-implementation-plan.md`.  

**Checkbox status** for T01–T13: see [§2.2](#22-tracker--v1-foundation-t01t13).

The original spec targeted **6 tools**; the repo now ships **9**. Optional follow-ons mentioned there (RMP, subreddit, multi-user, hosted server) are superseded by **T14–T22** and engineering track **E\***.

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

**Current direction (from roadmap):** pdfjs + `@napi-rs/canvas`, text-density heuristic (~250 chars), DPI/payload caps, hybrid text + PNG output, paginated fetches. **Future:** smarter diagram detection (see roadmap).

---

## 9. Phase A — Active product backlog (themes)

For **checkbox execution**, use [§2.3](#23-tracker--product-v11-t14-t22) and [§2.4](#24-tracker--product-polish-stream-t23-t26) (T23-T26) and tool roadmaps:

1. **PDF / files** — [`get_file_text/roadmap.md`](tools/get_file_text/roadmap.md).  
2. **Deadlines** — Playwright install; selector hardening; [`deadlines/roadmap.md`](tools/deadlines/roadmap.md).  
3. **Post-v1 tool depth** — [§6.2](#62-upcoming-tools-section--reinterpretation).  
4. **Scraper structure** — **T26** / [§2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown).  

---

## 10. Phase B — Product v2: external data (SIS, RMP, Reddit)

**Prerequisite:** patterns in [§4](#4-architecture-reference-single-source-of-truth). **Execution:** [§2.3](#23-tracker--product-v11-t1422) + [§2.8](#28-detailed-plan--t1422-v11-procedure).

### 10.1 New tools (planned)

| Tool | Source | Auth | Method |
|------|--------|------|--------|
| `get_exam_schedule` | York SIS `w2prod.sis.yorku.ca` | Yes (SSO; cookies after auth) | Playwright |
| `get_timetable` | Same | Yes | Playwright |
| `get_professor_rating` | RateMyProfessors | No | `fetch` + GraphQL |
| `search_york_reddit` | Reddit JSON API (`r/yorku`) | No | `fetch` |

### 10.2 Architecture deltas (v2-specific)

- **SIS cookies:** After eClass dashboard (and existing WAF/resource touch if present), navigate **SIS URLs once** before `context.cookies()` so `session.json` includes `w2prod.sis.yorku.ca`. Users with old sessions **re-authenticate** once.  
- **`session.ts`:** No change required if all cookies are saved; Playwright scopes cookies by domain.  
- **`src/scraper/sis.ts`:** New module — **do not** put SIS scraping in `eclass.ts`.  
- **RMP & Reddit:** Node **`fetch` only**; no new HTTP libraries; Reddit requires a descriptive **User-Agent**.  
- **TTL additions** (merge into `TTL` in `store.ts` when implementing):

```typescript
EXAM_SCHEDULE: 60 * 24,     // 24 hours
TIMETABLE: 60 * 24,         // 24 hours
PROFESSOR: 60 * 24 * 7,     // 7 days
REDDIT: 60 * 30,            // 30 minutes
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
  } catch { /* timeouts OK — cookie acquisition is the goal */ }
}
```

### 10.4 Final tool matrix after v2

| # | Tool | Source | Auth |
|---|------|--------|------|
| 1–9 | *(current eClass tools)* | eClass | Yes |
| 10 | `get_exam_schedule` | SIS | Yes (SSO) |
| 11 | `get_timetable` | SIS | Yes (SSO) |
| 12 | `get_professor_rating` | RMP | No |
| 13 | `search_york_reddit` | Reddit | No |

---

## 11. Phase C — Engineering excellence reference (gap to 9.0+)

**Full procedural steps:** [§2.5](#25-tracker--engineering-gap-to-9-e01-e19) and [§2.9](#29-detailed-plan--e01-e19-engineering-9-including-cicd).

### 11.1 Executive summary

The project scores roughly **7.4/10** on engineering maturity; largest gaps are **CI/CD, tests, security hardening, structured errors, observability, and release discipline**.

### 11.2 Scored rubric (0–10)

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
- **Three-sprint sketch:** Sprint 1 = E01–E07 + start E08; Sprint 2 = E08–E12 + early E14; Sprint 3 = E13–E15 + E16–E19.  

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

## 12. Phase D — Maintainer / codebase health

- **T26 — `src/scraper/eclass.ts` refactor:** Tracked in [§2.4](#24-tracker--product-polish-stream-t23-t26); full procedure in [§2.10](#210-detailed-plan--t26-scraper-modularization-eclassts-breakdown).  
- **Align docs** when tool counts or auth flows change (README + §2 trackers).

---

## Appendix A — Documentation map

| Topic | Path |
|-------|------|
| **This master plan** | `docs/PROJECT_MASTER.md` |
| E2E run log (create when running T11) | `docs/e2e-run-log.md` |
| Deadlines tool — roadmap & testing | `docs/tools/deadlines/roadmap.md` |
| Deadlines — history | `docs/tools/deadlines/history.md` |
| File / PDF — history & roadmap | `docs/tools/get_file_text/history.md`, `roadmap.md` |
| User-facing README | `README.md` |

---

## Appendix B — Scripts directory policy

- **Keep:** Runnable diagnostics and setup — `test-*.ts`, `debug-*.ts`, `discover-*.ts`, `check-course-id.ts`, `setup.mjs`, `setup-claude.sh`, `tsconfig.json` for scripts, etc.  
- **Remove from git or move to gitignored `scripts/output/`:** Captured dumps — `*.txt`, `*.json`, `.html` that are probe outputs.  
- **Optional:** `scripts/archive/` for one-off investigations + [`scripts/README.md`](../scripts/README.md).  

---

## Appendix C — Superseded root documents (removed)

The following were deleted from the repo root; use this file instead:

- `TODO.md` · `eclass-mcp-implementation-plan.md` · `mcp v2.md` · `review.md`

---

*End of project master document.*
