# eClass mobile REST capability matrix

**Branch:** `feat/eclass-mobile-token`
**Status:** Pending the account-owner probe. No function below has been
observed on York's site yet.
**Related:** [ADR 0011](../adr/0011-mobile-token-rest-access.md),
[findings log](../investigations/eclass-mobile-token-findings.md)

Function names are public Moodle API names and are safe to commit. The probe
never prints token values, user ids, usernames, site names, or emails.

## How to fill this in

1. Log in through the MCP `/auth` flow.
2. Run `npm run probe:mobile`.
3. Copy the `yes`/`no` column into **Available** below, and the
   `release`, `version`, `function count`, token length and shape, and private
   token presence into **Probe summary**.
4. Record the same facts, with the date and method, in the findings log.
5. Reload `/user/managetoken.php` and record whether a "Moodle mobile web
   service" row appears and its lifetime (no values).

The full function list is written to `.eclass-mcp/debug/mobile-functions.json`
(gitignored). Keep it local.

## Probe summary

| Field | Value |
| --- | --- |
| Date | Pending |
| Minted | Pending |
| Token length / 32-hex shape | Pending |
| Private token present | Pending |
| Moodle `release` / `version` | Pending |
| Function count | Pending |
| Token lifetime (`managetoken.php`) | Pending |

## Routing functions

| Function | Available | Used by |
| --- | --- | --- |
| `core_webservice_get_site_info` | Pending | Capability discovery; required for every REST route |
| `core_course_get_contents` | Pending | `get_course_content`, `get_section_text`; provides `fileurl` for token downloads |
| `mod_page_get_pages_by_courses` | Pending | Page prose for `get_section_text` |
| `mod_label_get_labels_by_courses` | Pending | Label text for `get_section_text` |
| `mod_resource_get_resources_by_courses` | Pending | Resource intros |
| `mod_folder_get_folders_by_courses` | Pending | Folder intros |
| `mod_url_get_urls_by_courses` | Pending | URL intros and targets |
| `mod_lti_get_ltis_by_courses` | Pending | Cengage/WebAssign discovery |
| `gradereport_overview_get_course_grades` | Pending | `get_grades` overview |
| `gradereport_user_get_grade_items` | Pending | `get_grades` per course |
| `mod_forum_get_forums_by_courses` | Pending | `get_announcements` (news forum lookup) |
| `mod_forum_get_forum_discussions` | Pending | `get_announcements` discussions |
| `mod_forum_get_discussion_posts` | Pending | `get_announcements` post bodies |
| `mod_assign_get_assignments` | Pending | `get_assignments` (eClass half), `get_item_details` |
| `mod_assign_get_submission_status` | Pending | `get_item_details`, `prepare_assignment_submission` (read-only) |
| `mod_quiz_get_quizzes_by_courses` | Pending | `get_assignments`, `get_item_details` for quizzes |
| `mod_quiz_get_user_attempts` | Pending | Quiz attempt state |
| `core_calendar_get_action_events_by_timesort` | Pending | No-cookie fallback for deadlines |
| `core_enrol_get_users_courses` | Pending | No-cookie fallback for `list_courses` |
| `core_course_get_updates_since` | Pending | Optional cache revalidation |
| `core_files_get_files` | Pending | Not routed; listed for completeness |
| `tool_mobile_get_autologin_key` | Pending | Optional cookie refresh (Phase 5.4) |

Every REST-backed tool stays capability-gated at runtime: if a function is
missing, the tool falls back to session AJAX or Playwright.

## Decision gate

If the mint fails or REST rejects the token, record the exact error codes in
the findings log, set ADR 0011 to Rejected or On hold, and ship only the
launch-parser fix.
