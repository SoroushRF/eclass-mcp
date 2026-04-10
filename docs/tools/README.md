# Tool Documentation Index

This directory contains one folder per currently registered MCP tool in `src/index.ts`.

## Current tools (22)

- `list_courses` -> `docs/tools/list_courses/README.md`
- `get_course_content` -> `docs/tools/get_course_content/README.md`
- `get_section_text` -> `docs/tools/get_section_text/README.md`
- `get_file_text` -> `docs/tools/get_file_text/README.md` (T22 complete)
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
- `get_cengage_assignments` -> `docs/tools/get_cengage_assignments/README.md` (supports `entryUrl` and legacy `ssoUrl`)
- `clear_cache` — see [README.md](../../README.md) (T26; skips pinned entries)
- `cache_pin`, `cache_unpin`, `cache_list_pins`, `cache_refresh_pin`, `cache_delete_pinned` — see [README.md](../../README.md) (T27 pinned cache)

## Existing deep-dive collections

- `docs/tools/deadlines/` contains the long-form deadlines roadmap/history/investigation docs.
- `docs/tools/get_file_text/` contains the long-form file/PDF roadmap/history docs for the completed T22 pipeline plus future refinements.
- `docs/cengage-integration-implementation-plan.md` tracks Cengage hardening phases, migration notes, and verification history.
