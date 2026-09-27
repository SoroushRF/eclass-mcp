# eClass hybrid release validation

**Branch:** `feat/eclass-hybrid-api`  
**Safe default:** `ECLASS_API_SOURCE_MODE=playwright`  
**Evidence policy:** no account credentials, cookies, `sesskey`, mobile
tokens, launch `Location` headers, account identifiers, or account-specific
URLs were collected.

## Automated validation

The final automated run completed on Windows with Node `v24.11.1`:

- `npm.cmd run test`: 91 files, 694 tests passed.
- `npm.cmd run test:coverage`: passed; global branch coverage is `75.00%`,
  meeting the existing threshold.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run typecheck:tests`: passed.
- `npm.cmd run lint`: passed with zero warnings.
- `npm.cmd run format:check`: passed.
- `npm.cmd run build`: passed.
- `git diff --check`: passed.
- `npm.cmd pack --dry-run`: passed; the package contains source, compiled
  output, and documentation but no local `.env`, session, cache, or mobile
  credential files.

`npm.cmd run doctor` was run with an ephemeral validation-only session secret:
17 checks passed and 4 warnings remained for the intentionally absent local
`.env`, eClass session, Cengage state, and Claude registration. No real secret
was written.

## Built MCP host smoke

The built `dist/index.js` was launched through the MCP SDK stdio client with
`ECLASS_API_SOURCE_MODE=playwright`, an empty session secret, and no account
session. Tool discovery returned exactly 26 tools, including
`list_courses` and `get_grades`. No AJAX, REST, or mobile-launch endpoint
traffic appeared during startup. The source-entrypoint stdio, protocol, and
dependency tests also passed.

The same artifact also passed the MCP Inspector CLI `tools/list` check and a
safe `cache_health` `tools/call`; see the
[host validation record](eclass-hybrid-host.md). This validates MCP framing,
tool discovery, the built artifact, and configuration rollback behavior. It
is not a credentialed eClass read.

## Live-account gate

The required local account-owner comparison was **not run** in this worktree:
there is no saved eClass session and no account credentials were supplied.
Therefore this branch does not claim live proof for API-primary courses,
course content, deadlines, or any REST function. Playwright remains the
release-safe default. The exact cold-cache and re-authentication comparison
rows are in
[`eclass-hybrid-canary.md`](./eclass-hybrid-canary.md).

Manual MCP Inspector and Claude Desktop prompt-matrix rows are likewise
not marked as live evidence. The generated E2E template is only a scaffold.

## Mobile REST routing promotion

Token REST routing (ADR 0011) is implemented behind the same source modes and
is **not promoted**: the default stays `playwright`, and no row below has
account-owner live evidence yet. A row is promoted only after
`npm run probe:mobile` shows the function in the token's service
([capability matrix](./eclass-mobile-rest-capabilities.md)) and a `shadow`
session logs `eClass API shadow match` for that operation with no recurring
mismatch category.

| Operation (`/hybrid/<op>`)  | Tool                 | REST functions                                                               | Deterministic tests | Live shadow | Promoted |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------- | ------------------- | ----------- | -------- |
| `course_content`            | `get_course_content` | `core_course_get_contents`                                                   | Yes                 | Pending     | No       |
| `grades`                    | `get_grades`         | `gradereport_user_get_grade_items`, `gradereport_overview_get_course_grades` | Yes                 | Pending     | No       |
| `announcements`             | `get_announcements`  | `mod_forum_get_forums_by_courses`, `mod_forum_get_forum_discussions`         | Yes                 | Pending     | No       |
| `assignment_index`          | `get_assignments`    | `mod_assign_get_assignments`, `mod_assign_get_submission_status`             | Yes                 | Pending     | No       |
| `courses` (fallback only)   | `list_courses`       | `core_enrol_get_users_courses`                                               | Yes                 | Pending     | No       |
| `deadlines` (fallback only) | `get_deadlines`      | `core_calendar_get_action_events_by_timesort`                                | Yes                 | Pending     | No       |
| `file_download`             | `get_file_text`      | `/webservice/pluginfile.php`                                                 | Yes                 | Pending     | No       |

Shadow mismatch categories to watch: `section_count`, `visible_module_set`,
`grade_item_set`, `grade_value`, `discussion_set`, `title_mismatch`,
`assignment_set`, `submission_status`. Expected, benign differences: REST
announcement and assignment dates are ISO 8601, while the Playwright path
returns page display text; these fields are not compared.

## Rollback rehearsal

The built host was started with:

```powershell
$env:ECLASS_API_SOURCE_MODE = "playwright"
node dist/index.js
```

The host discovery smoke passed without rebuilding another branch or making
API requests. Configuration rollback is:

1. Set `ECLASS_API_SOURCE_MODE=playwright`.
2. Restart the MCP host.
3. If a promoted API read changes normalized output, clear only affected
   unpinned account-scoped eClass cache entries and preserve valid pins.
4. Verify eClass reads use Playwright; SIS, Cengage/WebAssign, and write
   tools are unchanged.

REST token invalidation, logout cleanup, and session-context closure are
covered by deterministic unit tests. REST reads now run in `shadow` and `api`
modes when a mobile token is stored; `ECLASS_API_SOURCE_MODE=playwright`
disables all REST reads except token file downloads, which fall back to
Playwright on any failure. A live token-invalidation rehearsal remains an
account-owner step.

## Final gate status

The release checklist was rerun sequentially after the documentation commits:

- `doctor`: 17 passes, 4 expected local-environment warnings, 0 failures.
- `test`: 91 files and 694 tests passed.
- `test:coverage`: passed at 75.00% global branch coverage.
- `typecheck`, `typecheck:tests`, `lint`, `format:check`, `build`, and
  `git diff --check`: passed.
- `npm.cmd pack --dry-run`: passed without packaging `.env`, session, cache,
  or mobile credential files.
- `git status --short --branch`: clean on `feat/eclass-hybrid-api`.

The branch is not tagged, pushed, merged, or used to modify `master`. The
account-owner live comparison and desktop prompt matrix remain explicit
pre-promotion gates rather than being represented as completed evidence.
