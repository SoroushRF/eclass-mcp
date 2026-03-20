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
*Created: 2026-03-19*
