# Tool Documentation Index

This directory contains focused docs for the primary registered MCP tools in `src/index.ts`; small cache-management utilities are summarized from the main README instead of having one folder each.

## Current tools (25)

- `list_courses` -> `docs/tools/list_courses/README.md`
- `get_course_content` -> `docs/tools/get_course_content/README.md`
- `get_section_text` -> `docs/tools/get_section_text/README.md`
- `get_file_text` -> `docs/tools/get_file_text/README.md` (T22 complete)
- `get_assignments` -> `docs/tools/get_assignments/README.md` (canonical cross-platform eClass + Cengage/WebAssign resolver with active WebAssign context verification)
- `get_upcoming_deadlines` -> `docs/tools/get_upcoming_deadlines/README.md`
- `get_deadlines` -> `docs/tools/get_deadlines/README.md`
- `get_item_details` -> `docs/tools/get_item_details/README.md`
- `get_grades` -> `docs/tools/get_grades/README.md`
- `get_announcements` -> `docs/tools/get_announcements/README.md`
- `get_exam_schedule` -> `docs/tools/get_exam_schedule/README.md`
- `get_class_timetable` -> `docs/tools/get_class_timetable/README.md`
- `search_professors` -> `docs/tools/search_professors/README.md`
- `get_professor_details` -> `docs/tools/get_professor_details/README.md`
- `discover_cengage_links` -> `docs/tools/discover_cengage_links/README.md`
- `list_cengage_courses` -> `docs/tools/list_cengage_courses/README.md`
- `get_cengage_assignments` -> `docs/tools/get_cengage_assignments/README.md` (direct-link-first for WebAssign/LTI links, dashboard fallback, and `needs_course_activation` context guard)
- `get_cengage_assignment_details` -> `docs/tools/get_cengage_assignment_details/README.md`
- `clear_cache` - see [README.md](../../README.md) (T25; skips pinned entries)
- `cache_health` - see [README.md](../../README.md) (read-only aggregate cache/pin health and process-local cache metrics)
- `cache_pin`, `cache_unpin`, `cache_list_pins`, `cache_refresh_pin`, `cache_delete_pinned` - see [README.md](../../README.md) (T26 pinned cache)

## Existing deep-dive collections

- `docs/tools/deadlines/` contains the long-form deadlines roadmap/history/investigation docs.
- `docs/tools/get_file_text/` contains the long-form file/PDF roadmap/history docs for the completed T22 pipeline plus future refinements.
- `docs/cengage-integration-implementation-plan.md` tracks Cengage hardening phases, migration notes, and verification history.
