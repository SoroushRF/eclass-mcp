# Deadlines & Details Roadmap

## PURPOSE
This document outlines the strategy for evolving the Deadlines tool from a simple "Upcoming" list into a dynamic calendar-aware system with deep-dive capabilities.

## 🧭 Phase 1: Dynamic Month Navigation
Goal: Allow Claude to see assignments from any month (Past or Future).

### Implementation Details
- **Source:** `calendar/view.php?view=month`
- **Logic:** Construct URLs with `time=TIMESTAMP` to jump to any month in history.
- **Scraping:** 
    - Identify all events in the month grid.
    - Filter for `mod_assign`, `mod_quiz`, and `mod_feedback`.
    - Extract `detailsUrl` for every event.

## 🧭 Phase 2: Assignment Deep-Dive (`get_assignment_info`)
Goal: Give Claude the ability to "read" the instructions and check your submission status.

### Scraping Targets (Activity Page)
| Data Point | CSS Selector (Probable) |
| --- | --- |
| **Instructions** | `.no-overflow` or `#intro` |
| **Status** | `.submissionstatustable` |
| **Files** | `a[href*="pluginfile.php"]` within instructions |
| **Due Date** | Extracted text from the status table for confirmation |

## 🧭 Phase 3: Claude Workflow
- Update MCP Tool definitions to include `month` / `year` arguments for `get_deadlines`.
- Register the new `get_assignment_info` tool.

---
*Created: 2026-03-19*
*Status: Planning Approved*
