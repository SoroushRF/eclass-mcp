# E2E Run Log

## Run [N] — YYYY-MM-DD

### Environment
| Field | Value |
|-------|-------|
| Date | |
| OS | |
| Node version (`node -v`) | |
| Claude Desktop version | |
| Repo commit (`git rev-parse HEAD`) | |
| Cache state | cold / warm (delete `.eclass-mcp/cache/*` for cold) |
| Session state | fresh / reused |

### Tool matrix results

| # | Tool | Prompt used | Result | Evidence | Issue # | Notes |
|---|------|-------------|--------|----------|---------|-------|
| 1 | `list_courses` | | Pass / Fail / Skip | | | |
| 2 | `get_course_content` | | Pass / Fail / Skip | | | |
| 3 | `get_section_text` | | Pass / Fail / Skip | | | |
| 4 | `get_file_text` | | Pass / Fail / Skip | | | |
| 5 | `get_upcoming_deadlines` | | Pass / Fail / Skip | | | |
| 6 | `get_deadlines` (month) | | Pass / Fail / Skip | | | |
| 7 | `get_deadlines` (range) | | Pass / Fail / Skip | | | |
| 8 | `get_item_details` | | Pass / Fail / Skip | | | |
| 9 | `get_grades` | | Pass / Fail / Skip | | | |
| 10 | `get_announcements` | | Pass / Fail / Skip | | | |
| S | Session expiry | | Pass / Fail / Skip | | | |

### Definitions
- **Pass:** tool was invoked and response passed all structural checks for that row.
- **Fail:** tool was not invoked, threw an error, or response failed a structural check. File an issue.
- **Skip:** tool could not be tested (e.g. no PDF in courses). Document reason in Notes.
- **Evidence:** paste the raw JSON snippet returned (redact personal info), or note "no JSON visible."
- **Issue #:** record the GitHub issue number for any Fail row.

### Issues filed
_List any GitHub issue numbers created from failures._
