# Deadlines Tool Implementation History

## PURPOSE

This document tracks the incremental fixes and features added to the Deadlines and Details tool.

## 🏁 Phase 0: The "Selector Fix" (Completed)

**Date:** 2026-03-19
**What we did:**

- Discovered new eClass selectors for the Moove theme (Bootstrap Cards).
- Fixed the scraper to find event titles and URLs in the card structure.
- Implemented `parseEClassDate` helper to handle Moodle date strings.
- Standardized the deadlines tool response to return raw upcoming items (future-only).

---

## ✅ Phase 1: Scopes (Upcoming/Month/Range) + Details Tools (Completed)

**Date:** 2026-03-19
**What we did:**

- Added MCP tool `get_deadlines` with `scope` = `upcoming | month | range`.
- Implemented month-view calendar scraping via `.calendar_event_course` (plus fallbacks).
- Added `get_item_details` for deep-fetching a single assignment/quiz page.
- Added optional `includeDetails` / `maxDetails` in `get_deadlines` to auto-fetch details for the first N items.
- Added a per-URL details cache with `TTL.DETAILS` (1 hour).

**Known runtime prerequisite:**

- Playwright requires `npx playwright install chromium` once on the host machine.

---

## ✅ Phase 2: Historical Deadlines Root-Cause Fix (Completed)

**Date:** 2026-03-19
**What we changed:**

- Confirmed via live DevTools probes that calendar month view was not a reliable source in this tenant.
- Pivoted month/range queries to assignment index pages:
  - `mod/assign/index.php?id=<courseId>`
- Added aggregation across one/all courses and date-based filtering for:
  - `scope=month`
  - `scope=range`
- Added day-boundary normalization for range inputs using `YYYY-MM-DD`.
- Extended returned `DeadlineItem` data with `section`, `submission`, and `grade` from assignment rows.

**Verification outcome:**

- User confirmed both previously failing prompts now work:
  - March month query returned results.
  - January range query returned historical results.

---

## ✅ Phase 3: Vision Instruction Images + CSV Inlining (Completed)

**Date:** 2026-03-20
**What we did:**

- Updated `get_item_details` to optionally attach instruction screenshots as **vision `image` blocks** (no OCR) using `includeImages` plus strict payload caps/pagination.
- Updated `get_item_details` to optionally inline **CSV attachments** as text using `includeCsv` with full/preview + byte/line limits.
- Extended scraping to return:
  - `descriptionImageUrls` for instruction screenshots
  - `attachments[]` for downloadable resources across varied formats

**Verification outcome:**

- Instruction screenshot reading works with `includeImages=true`.
- CSV inlining works for `kind: "csv"` attachments with `csvMode=full|preview`.

---

## ✅ Phase 4: Course Label Enrichment for Deadline Items (Completed)

**Date:** 2026-03-20
**What we did:**

- Extended deadline payloads to include `courseName` and best-effort `courseCode` in addition to `courseId`.
- Enriched both upcoming-calendar items and assignment-index-backed items with human-readable course metadata.
- Bumped deadline cache keys so stale `courseId`-only entries would not keep leaking into Claude responses.

**Why this mattered:**

- Claude could answer deadline questions correctly but still label some items as `Course 149363` because the tool output only exposed the raw eClass course ID.
- After this change, clients can prefer `courseCode` or `courseName` when summarizing what the student should study.

**Verification outcome:**

- TypeScript compile check passed after the payload shape change.
- Next deadline fetch will bypass the old cache key and return refreshed items with readable course labels.

---

## âœ… Phase 5: Quiz Grade + Assignment Description Hardening (Completed)

**Date:** 2026-03-23
**What we did:**

- Hardened quiz detail parsing so visible grades and attempt summaries are captured more reliably across themes.
- Improved assignment detail extraction so authored instruction text and image references are preserved instead of wrapper boilerplate.
- Verified the previously failing P3/P4 cases and updated the tracker docs to reflect completion.

**Verification outcome:**

- Quiz details now include visible grade/score data when present.
- Assignment details now return meaningful instructions with image references when present.
- P3/P4 are marked done in the investigation plan and roadmap.

---

_Created: 2026-03-19_
