# ADR 0010: Hybrid eClass Data Access (Session JSON + Optional Mobile Handshake)

## Status

Accepted behind the `playwright` default. Investigation complete 13 August
2026; API-primary remains an explicit, reversible local rollout mode.

## Context

The engine collects York eClass data by driving Chromium: visible Passport York login, encrypted cookies ([ADR 0002](./0002-secure-session-storage.md)), then headless `page.goto` and DOM selectors ([ADR 0004](./0004-selector-registry.md)). That is reliable enough for a local beta and expensive to deploy: Chromium, selector drift, long navigation budgets ([operational-limits.md](../operational-limits.md)).

A comparable UTSC student MCP talks to **Canvas (Quercus)** with a personal access token from Account → Settings. eClass is **Moodle 5.1**, not Canvas. Students do not get a copy-paste mobile token on Preferences → Security keys (RSS keys only). York does enable Moodle web services and the official mobile app (`enablewebservices=1`, `enablemobilewebservice=1`, `typeoflogin=3` embedded-browser SSO).

Live evidence is in [eclass-official-api-feasibility.md](../investigations/eclass-official-api-feasibility.md). Short version:

- `/lib/ajax/service.php` with session cookies + `sesskey` already returns enrolled courses, course-format state, and calendar JSON.
- `core_course_get_contents`, `mod_assign_get_assignments`, `mod_forum_get_forums_by_courses`, and `gradereport_user_get_grade_items` are **not** AJAX-callable here (`servicenotavailable`). They belong to the mobile REST service.
- `/webservice/rest/server.php` is live (`invalidtoken` without a key).
- `/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=…` after SSO returns **302** `Location: moodlemobile://…` with a `token=` parameter — the official app handshake.
- `/login/token.php` exists but campus login is SAML. Do not design around Passport York passwords posted to that script.
- SIS and Cengage are not Moodle.

## Decision

Adopt **hybrid eClass access**. Do not wait for a Canvas-style settings token that York does not offer students.

1. **Keep** local-first MCP ([ADR 0001](./0001-local-first-mcp.md)), encrypted session storage ([ADR 0002](./0002-secure-session-storage.md)), URL allowlisting, and a visible browser for Passport York / Shibboleth.
2. **Prefer session JSON** (`POST /lib/ajax/service.php`) for functions proven AJAX-allowed: course list, course-format state, calendar/deadlines.
3. **Optionally mint a Moodle mobile credential** only through the official launch handshake (or QR login), after an existing SSO session. Persist it in the encrypted session envelope. Use `/webservice/rest/server.php` for functions that AJAX rejects (grades, forums, assignments, `core_course_get_contents`).
4. **Keep Playwright HTML** for SIS, Cengage/WebAssign, assignment preflight/item details until a JSON path is proven per tool, and as fallback while dual-running.
5. **Reject** as product design: scraping HTML when a proven JSON function exists; storing mobile tokens in `.env` or plaintext; logging `sesskey`, cookies, or launch `Location` headers; using RSS keys as REST tokens.

Tool routing (initial):

| Tool family | Primary path after this ADR |
| --- | --- |
| `list_courses` | AJAX timeline classification |
| `get_course_content` | AJAX `core_courseformat_get_state` |
| `get_deadlines` / `get_upcoming_deadlines` | AJAX calendar functions |
| `get_section_text`, `get_file_text` | Hybrid: JSON outline + existing download/HTML where needed |
| `get_grades`, `get_announcements`, eClass assignment details | HTML until each REST function passes account-owned validation |
| `prepare_assignment_submission`, `get_item_details` | Playwright |
| SIS, Cengage | Unchanged |
| Login / `SESSION_EXPIRED` | Unchanged visible auth |

Implementation dual-runs JSON vs scrape behind `ECLASS_API_SOURCE_MODE=shadow`
before API-primary can be selected. The API provider compares normalized
courses, visible course modules, and deadlines, keeps Playwright authoritative
in shadow mode, and falls back once for bounded read-only failures. See the
[canary acceptance record](../validation/eclass-hybrid-canary.md). Re-check
public `tool_mobile_get_public_config` if York changes mobile settings.

The capability-gated REST client is an internal read-only building block, but
no REST-backed MCP tool is promoted by this ADR. Missing capabilities, unproven
payloads, and invalid mobile credentials continue through the existing
Playwright paths.

## Consequences

- Chromium remains required for SSO (and for SIS/Cengage/HTML leftovers). Deploy becomes easier for **eClass read tools that move to JSON**, not for a fully headless zero-browser binary.
- Two Moodle gateways must be tested and mapped into structured errors ([ADR 0005](./0005-tool-boundary-structured-errors.md)): `servicenotavailable`, `invalidtoken`, session expiry.
- Launch-handshake credentials are as powerful as the student session. They inherit ADR 0002 encryption and the investigation doc’s security rules. Never commit them.
- Selector registry shrinks as tools migrate; it is not deleted until HTML tools are gone.
- Cache metadata ([ADR 0003](./0003-file-cache.md), [ADR 0009](./0009-cache-observability.md)) should apply to JSON responses the same way as scrape responses.
- First shippable win is `list_courses` + course outline + deadlines without waiting on REST.

## References

- [Investigation report](../investigations/eclass-official-api-feasibility.md)
- Moodle public config `tool_mobile_get_public_config`
- [Moodle web service client docs](https://docs.moodle.org/dev/Creating_a_web_service_client)
- [York LTS mobile app](https://lthelp.yorku.ca/mobile-app)
