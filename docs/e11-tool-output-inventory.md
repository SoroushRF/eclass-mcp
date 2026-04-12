# E11 tool output inventory (wire shapes)

Checklist for MCP `server.tool` registrations in `src/index.ts`. Validation uses Zod in `src/tools/eclass-contracts.ts` + `asValidatedMcpText` / `asValidatedMcpResult`.

**E12:** Optional `code` on error/auth-related payloads (`src/errors/codes.ts`); rolled out incrementally — see README “Structured error codes (E12)”.

| Tool | Response shape | Notes |
|------|----------------|--------|
| `list_courses` | JSON: `attachCacheMeta` on `{ courses }` or `no_data`, or `auth_required` | No plain text |
| `get_course_content` | JSON + `_cache`, or `auth_required` JSON | Migrated from plain `e.message` |
| `get_section_text` | JSON + `_cache`, or `auth_required` JSON | Same |
| `get_file_text` | `{ content: ContentBlock[] }` | text / image blocks |
| `get_upcoming_deadlines` | JSON + `_cache`, or `auth_required` | |
| `get_deadlines` | JSON + `_cache`, or `auth_required` | |
| `get_item_details` | Multi-block: metadata JSON + optional CSV text + images | Metadata validated; CSV prose not |
| `get_grades` | JSON + `_cache`, or `auth_required` | |
| `get_announcements` | JSON + `_cache`, or `auth_required` | |
| `get_exam_schedule` | Single JSON text: `status`, `message`, `exams?` | No prose-with-embedded-JSON |
| `get_class_timetable` | Single JSON text: `status`, `message`, `entries?` | Same |
| `search_professors` | Single JSON text: `summary`, `matches`, `diagnostics`, `_cache?` | Machine + human-readable summary |
| `get_professor_details` | Single JSON text: `summary`, `professor`, `recentReviews`, `_cache?` or `{ ok:false, error }` | |
| `discover_cengage_links` | Cengage contracts + `responses.ts` | Unchanged validation path |
| `list_cengage_courses` | Cengage | |
| `get_cengage_assignments` | Cengage | |
| `get_cengage_assignment_details` | Cengage | |
| `clear_cache` | JSON `ok` + `message` + counts | |
| `cache_pin` / `cache_unpin` / `cache_list_pins` / `cache_refresh_pin` / `cache_delete_pinned` | JSON (`ok`, etc.) | `jsonResponse` + schema |

[`attachCacheMeta`](../src/cache/store.ts): arrays become `{ items, _cache }`; objects spread with `_cache`; primitives become `{ value, _cache }`.
