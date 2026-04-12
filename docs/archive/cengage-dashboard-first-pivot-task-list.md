# Cengage Dashboard-First Pivot Task List

## Purpose

Replace the current link-first Cengage/WebAssign flow with a dashboard-first flow that starts from the user's saved Cengage session whenever possible.

This pivot is motivated by a real product gap:

- The repo can authenticate the user to Cengage/WebAssign already.
- Before the pivot, tools assumed we should start from an `entryUrl` discovered from eClass, a PDF, or a pasted link.
- In practice, instructors use many different link shapes, wrappers, PDFs, and enrollment pages.
- WebAssign is easier to model as "log into your account, enumerate your dashboard courses, then open assignments."

## Current State Summary

- Cengage auth already exists via `/auth-cengage` and saves Playwright storage state under `.eclass-mcp/`.
- `list_cengage_courses` and `get_cengage_assignments` now support dashboard-first mode without `entryUrl`, while preserving explicit-link compatibility.
- `discover_cengage_links` is retained as bootstrap/fallback and remains useful for edge cases.
- Enrollment wrappers such as `getenrolled.com` no longer masquerade as stable course inventory by default.
- Cengage helper internals are now split under `src/tools/cengage/*` and `src/scraper/cengage/*` for maintainability.
- Coverage now includes fixture and scenario suites for dashboard and selection flows; additional live-like breadth remains in scope under P11b.

## Target Product Shape

- Primary flow:
  - User logs into Cengage/WebAssign once.
  - Tool opens the canonical dashboard or student home from saved session.
  - Tool enumerates all available courses.
  - Tool selects a course by `courseId`, `courseKey`, or course title.
  - Tool opens the course and extracts assignments.
- Secondary flow:
  - If no dashboard inventory is available, fall back to discovered launch links from eClass, announcements, item descriptions, or files.
- Compatibility:
  - Existing `entryUrl` and legacy `ssoUrl` behavior should continue to work during migration.

## Non-Goals

- Do not add write actions.
- Do not remove discovery-based flows entirely.
- Do not couple WebAssign logic tightly to eClass course content.
- Do not redesign WeBWorK in this doc; WeBWorK may still need a more hybrid model.

## Progress Snapshot (2026-04-11)

- Completed in repo: P00, P01, P02a, P02b, P02c, P03, P03a, P04, P05, P06, P07, P08, P09, P10, P11b, P12.
- Next task in sequence: none in this pivot track (dashboard-first pivot scope complete).
- Remaining major items after P10: none.

## Task List (Refined)

### P00 - Baseline Guardrails Before Pivot

Description:

- Stabilize baseline behavior before refactoring by hardening test and fixture assumptions.

Notes:

- Ensure fixture reads are path-safe regardless of whether tests run from workspace root or repo root.
- Record baseline status/response behavior for current link-first paths.
- This reduces false negatives while changing contracts/navigation.

Main files:

- `tests/cengage-*.test.ts`
- `tests/cengage-fixtures.test.ts`
- `docs/e2e-run-log.md`

Done criteria:

- Baseline Cengage tests run consistently from different working directories.
- Existing link-first behavior is explicitly documented as migration baseline.

Dependencies:

- None.

### P01 - Define Dashboard-First Contracts (Schema Layer)

Description:

- Update tool contracts so Cengage tools can run without an `entryUrl` when a valid Cengage session exists.

Notes:

- `ListCengageCoursesInputSchema` currently requires `entryUrl`.
- `GetCengageAssignmentsInputSchema` currently requires `entryUrl` or `ssoUrl`.
- We should support dashboard-first mode such as:
  - `list_cengage_courses({})`
  - `get_cengage_assignments({ courseQuery: "MATH 1014" })`
- Preserve backwards compatibility with link-driven inputs.

Main files:

- `src/tools/cengage-contracts.ts`
- `src/tools/cengage.ts`
- `docs/tools/list_cengage_courses/README.md`
- `docs/tools/get_cengage_assignments/README.md`

Done criteria:

- Schemas allow dashboard-first mode without breaking existing callers.
- Response shapes remain stable and machine-usable.

Dependencies:

- P00.

### P02a - Define Canonical Home URLs and Precedence

Description:

- Define a canonical, ordered set of post-auth Cengage/WebAssign home URLs for saved-session bootstrap.

Notes:

- Include domain variants observed in real dumps (`cengage.ca` and `cengage.com`) and WebAssign student/home endpoints.
- Keep order deterministic to avoid flaky behavior.

Main files:

- `src/scraper/cengage.ts`
- `src/scraper/cengage-state.ts`

Done criteria:

- Canonical start URL list exists with deterministic fallback order.
- URL set covers known dashboard/student-home variants.

Dependencies:

- P01.

### P02b - Add Saved-Session Bootstrap Navigator

Description:

- Implement a scraper path that starts from saved session plus canonical homes when no explicit `entryUrl` is provided.

Notes:

- This is the actual behavior switch for dashboard-first inventory bootstrap.
- Should return structured outcomes (`ok`, `auth_required`, `error`) with diagnostics.

Main files:

- `src/scraper/cengage.ts`
- `src/scraper/cengage/navigation.ts`
- `src/tools/cengage.ts`

Done criteria:

- Scraper can bootstrap course discovery without user-provided links.
- Tool layer can call bootstrap path deterministically when no `entryUrl` is passed.

Dependencies:

- P02a.

### P02c - Normalize State Detection for Domain and URL Variants

Description:

- Improve page-state markers so canonical dashboard detection does not depend only on incidental course-link markers.

Notes:

- Add explicit support for `cengage.ca/dashboard/*` and related variants.
- Preserve existing login/course/assignment detection behavior.

Main files:

- `src/scraper/cengage-state.ts`
- `tests/cengage-state.test.ts`

Done criteria:

- Dashboard URLs on both `.ca` and `.com` classify correctly.
- Diagnostics markers reflect explicit dashboard-url detection where applicable.

Dependencies:

- P02a.

### P03 - Split Dashboard Inventory from Explicit-Link Navigation

Description:

- Separate "list my courses from saved account session" from "follow this specific launch link."

Notes:

- Current `listDashboardCourses(entryUrl)` does both jobs.
- We should split into clearer methods:
  - dashboard inventory from saved session
  - inventory/navigation from explicit entry link
- This reduces pressure to treat enrollment pages as real course pages.

Main files:

- `src/scraper/cengage.ts`
- `src/tools/cengage.ts`

Done criteria:

- Scraper exposes distinct methods for dashboard-first inventory and explicit-link inventory.
- Tool layer chooses path deterministically based on inputs.

Dependencies:

- P02b.

### P03a - Add Card-Based Dashboard Extractor

Description:

- Add a first-class dashboard card extractor that reads card title and launch link from card structure, not just free-form anchors.

Notes:

- Real dumps show stable selectors for card/title/launch link.
- This should improve title quality and reduce generic "OPEN WEBASSIGN" title artifacts.

Main files:

- `src/scraper/cengage.ts`
- `src/scraper/cengage/dashboard-inventory.ts`
- `src/scraper/cengage-courses.ts`
- `tests/fixtures/cengage/*`
- `tests/cengage-fixtures.test.ts`

Done criteria:

- Extractor returns course titles from dashboard cards (for example "MATH 1014 O").
- Launch links are mapped from the corresponding card launch action.

Dependencies:

- P03.

### P04 - Remove Misleading Synthetic-Course Fallback for Enrollment Pages

Description:

- Tighten fallback behavior so pages like `getenrolled.com` do not masquerade as real courses unless they truly resolve to dashboard/course contexts.

Notes:

- `inferCourseFromCurrentPage()` is useful for true course pages.
- It should not be the primary way to "discover" courses from enrollment wrappers/interstitials.

Main files:

- `src/scraper/cengage.ts`
- `src/scraper/cengage-courses.ts`
- `src/scraper/cengage-state.ts`

Done criteria:

- Enrollment/registration pages no longer produce misleading synthetic course summaries.
- Synthetic fallback is limited to true course-like contexts and explicit fallback paths.

Dependencies:

- P03a.

### P05 - Add Dashboard-First Course Cache

Description:

- Cache discovered dashboard course inventory as a first-class Cengage artifact.

Notes:

- Current cache keys are tied to `entryUrl`.
- Dashboard-first mode needs inventory cache keys independent of arbitrary discovered links.
- Cache should refresh/invalidate after Cengage re-auth.

Main files:

- `src/tools/cengage.ts`
- `src/tools/cengage/cache.ts`
- `src/cache/store.ts`
- `src/auth/server.ts`

Done criteria:

- Course inventory is cached independently of launch-link shape.
- Re-auth refreshes/invalidate stale dashboard inventory correctly.

Dependencies:

- P04.

### P06 - Add Dashboard-First Course Selection

Description:

- Allow course selection by title/id/key from dashboard inventory alone.

Notes:

- `resolveDashboardCourseSelection()` already exists and is reusable.
- Main improvement is upstream quality: better inventory/titles/default source data.
- Optional eClass-course matching can come later.

Main files:

- `src/scraper/cengage-courses.ts`
- `src/tools/cengage.ts`

Done criteria:

- `get_cengage_assignments({ courseQuery: "MATH 1014" })` works from saved dashboard inventory alone when course exists.
- Ambiguity responses remain structured and deterministic.

Dependencies:

- P05.

### P07 - Refactor Assignment Retrieval to Prefer Dashboard-First Resolution

Description:

- Make assignment retrieval prefer saved-session dashboard inventory before explicit `entryUrl` fallback.

Notes:

- New order:
  - if explicit `courseId`/`courseKey`/`courseQuery` with no `entryUrl`, resolve from dashboard inventory
  - if explicit `entryUrl`, use link-driven flow
  - if both exist, choose a documented precedence
- Keep manual links supported while simplifying default UX.

Main files:

- `src/tools/cengage.ts`
- `src/scraper/cengage.ts`
- `src/scraper/cengage/assignments.ts`
- `docs/tools/get_cengage_assignments/README.md`

Done criteria:

- Assignment retrieval works in dashboard-first mode.
- Link-driven compatibility still works.
- Error messages guide retries clearly.

Dependencies:

- P06.

### P08 - Add All-Courses / All-Assignments Aggregation Mode

Description:

- Expose a bounded path to fetch assignment summaries across dashboard courses.

Notes:

- Solves "which course has WebAssign?" by asking platform inventory directly.
- Keep first version bounded (summary aggregation only).

Main files:

- `src/tools/cengage.ts`
- `src/scraper/cengage.ts`
- `src/scraper/cengage/assignments.ts`
- `src/tools/cengage-contracts.ts`

Done criteria:

- Documented and bounded all-courses assignment mode exists.
- Response size/runtime remain controlled.

Dependencies:

- P07.

### P09 - Keep Discovery as Bootstrap and Fallback Only

Description:

- Reframe discovery so it helps bootstrap edge cases but is no longer the primary assignment path.

Notes:

- Discovery still matters for first-time enrollment and hidden links in files/announcements.
- Discovery should hand off into dashboard/session flow quickly.

Main files:

- `src/tools/cengage.ts`
- `src/tools/cengage/link-discovery.ts`
- `docs/tools/discover_cengage_links/README.md`
- `README.md`

Done criteria:

- Docs and behavior treat discovery as secondary.
- Prompts/examples no longer default to brittle link chasing.

Dependencies:

- P07.

### P10 - Harden Redirect and Interstitial Navigation

Description:

- Improve state machine and navigation resilience for redirects/spinners/interstitial transitions around canonical homes.

Notes:

- Build on existing retry logic for transient execution-context loss.
- Explicitly model transitions across login, dashboard, enrollment, student home, course, assignments, unknown.

Main files:

- `src/scraper/cengage-state.ts`
- `src/scraper/cengage.ts`
- `src/scraper/cengage/navigation.ts`
- `tests/cengage-state.test.ts`

Done criteria:

- Canonical dashboard-first entry is resilient to redirect churn.
- Structured diagnostics remain available for unknown states and transition paths.

Dependencies:

- P07.

### P11a - Early Live-Like Fixture Coverage (Safety Net)

Description:

- Add minimum fixture coverage early for dashboard card parsing and enrollment guardrails.

Notes:

- Do this earlier than full test expansion to protect the most brittle pivot points.

Main files:

- `tests/cengage-*.test.ts`
- `tests/fixtures/cengage/*`

Done criteria:

- Fixtures validate dashboard-card extraction and enrollment-page fallback constraints.
- Tests are clearly labeled as fixture/navigation semantics tests.

Dependencies:

- P04.

### P11b - Expand Live-Like Coverage and Reduce Mocked Blind Spots

Description:

- Broaden coverage so pivot validation is not mostly scraper-mocked tool contracts.

Notes:

- Add fixture suites for student-home transitions, ambiguous selection, dashboard-first assignment extraction.
- Keep contract tests, but separate naming for mocked contract tests vs live-like navigation tests.

Main files:

- `tests/cengage-*.test.ts`
- `tests/fixtures/cengage/*`
- `docs/e2e-run-log.md`

Done criteria:

- Coverage demonstrates dashboard-first behavior end-to-end at fixture level.
- Test naming clearly distinguishes mocked vs live-like validation.

Dependencies:

- P10.

### P12 - Update Docs, Prompts, and Troubleshooting to New Mental Model

Description:

- Rewrite Cengage docs so the default story is "sign in once, then ask for courses/assignments," not "find the magic URL."

Notes:

- Dashboard-first examples first.
- Discovery-based examples moved to fallback/troubleshooting sections.
- Explicit guidance on when enrollment links still matter.

Main files:

- `README.md`
- `docs/tools/discover_cengage_links/README.md`
- `docs/tools/list_cengage_courses/README.md`
- `docs/tools/get_cengage_assignments/README.md`
- `docs/PROJECT_MASTER.md`

Done criteria:

- Docs reflect target product shape and default user flow.
- Maintainers/agents are less likely to route users into brittle link-first paths.

Dependencies:

- P09.

## Recommended Execution Order

1. P00
2. P01
3. P02a
4. P02b
5. P02c
6. P03
7. P03a
8. P04
9. P11a
10. P05
11. P06
12. P07
13. P10
14. P08
15. P09
16. P11b
17. P12

## Risks and Open Questions

- Cengage dashboard shape may differ between accounts, products, or institutions.
- Some courses may only appear after explicit enrollment completion from a `getenrolled.com` page.
- WebAssign student home and Cengage dashboard may not always expose identical inventory.
- `.ca`/`.com` dashboard variants can drift independently and should be validated in detection logic.
- We may later want a small "platform home resolver" that remembers the best known home URL after successful auth.
- If WeBWorK is expanded under a similar product model, avoid forcing WebAssign assumptions onto it.

## Practical Success Criteria

- A user can authenticate once with `/auth-cengage`.
- Claude can list WebAssign/Cengage courses without being given a link.
- Claude can get assignments for `MATH 1014` from saved platform session alone.
- Discovery from eClass/PDF remains available, but it is no longer the main path.
- Refactors ship in small, testable slices with stable compatibility behavior.
