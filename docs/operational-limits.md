# Operational Limits

## Summary

E19 documents current behavior; it does not change runtime limits. This page is the maintainer-facing contract for how the engine behaves when eClass, SIS, Cengage/WebAssign, RateMyProfessors, or browser navigation is slow, busy, rate-limited, or stuck.

Timeouts should be treated as platform health signals, auth state signals, or selector drift signals depending on context. The same "timeout" symptom can mean a human login is unfinished, Moodle never reached the expected page, Cengage is stuck on a dashboard/interstitial, or an external HTTP service is rejecting traffic.

## Timeout Inventory

| Area                          |                               Current Limit | Current Behavior                                                                                                                                                     | Source                                                                          |
| ----------------------------- | ------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Visible auth browser          |                                  10 minutes | eClass and Cengage auth windows wait for the user to finish login before saving session state.                                                                       | [`src/auth/server.ts`](../src/auth/server.ts)                                   |
| eClass/SIS auth retry wait    |                       2 minutes, 1s polling | eClass/SIS tools open `/auth`, wait for a valid saved session, then retry the original operation once. Override with `ECLASS_MCP_AUTH_WAIT_MS`.                      | [`src/auth/server.ts`](../src/auth/server.ts)                                   |
| Cengage auth retry wait       |                Defaults to eClass auth wait | Cengage-backed resolver paths wait for Cengage session validity. Override with `ECLASS_MCP_CENGAGE_AUTH_WAIT_MS`; otherwise falls back to `ECLASS_MCP_AUTH_WAIT_MS`. | [`src/auth/server.ts`](../src/auth/server.ts)                                   |
| eClass dashboard course list  |              60s navigation, 20s DOM settle | Opens `/my/courses.php`, then waits for known course-card/link selectors or a settled empty dashboard.                                                               | [`src/scraper/eclass/courses.ts`](../src/scraper/eclass/courses.ts)             |
| eClass course content         |                              60s navigation | Uses `waitUntil: 'load'`; avoids universal `networkidle` because Moodle background requests can stay active.                                                         | [`src/scraper/eclass/courses.ts`](../src/scraper/eclass/courses.ts)             |
| eClass section text           |        30s navigation, 15s main-region wait | Uses `domcontentloaded` plus `#region-main` / `[role="main"]` readiness.                                                                                             | [`src/scraper/eclass/sections.ts`](../src/scraper/eclass/sections.ts)           |
| eClass announcements          |                              30s navigation | Uses shared announcement `GOTO_OPTS` with `domcontentloaded`.                                                                                                        | [`src/scraper/eclass/announcements.ts`](../src/scraper/eclass/announcements.ts) |
| eClass grades                 |                              30s navigation | Uses shared grade `GOTO_OPTS`.                                                                                                                                       | [`src/scraper/eclass/grades.ts`](../src/scraper/eclass/grades.ts)               |
| eClass file wrapper           | 20s wrapper navigation, 20s WAF reload wait | File wrapper pages wait for `domcontentloaded`; AWS WAF challenge reload is best-effort.                                                                             | [`src/scraper/eclass/files.ts`](../src/scraper/eclass/files.ts)                 |
| eClass API reads              | 15s default, 60s maximum                    | Uses authenticated `BrowserContext.request` with bounded response bodies. `shadow` is Playwright-authoritative; API-primary permits one read-only Playwright fallback except for `SESSION_EXPIRED` and `RATE_LIMITED`. | [`src/scraper/eclass/api/transport.ts`](../src/scraper/eclass/api/transport.ts) |
| eClass API response body      | 2 MiB default                                | AJAX and REST responses larger than the bounded transport limit fail as `UPSTREAM_ERROR`/malformed API data; request logs retain only path, status, duration, and size. | [`src/scraper/eclass/api/transport.ts`](../src/scraper/eclass/api/transport.ts) |
| Mobile launch / REST capability discovery | Same API timeout, in-memory capability set | The official mobile launch handshake is optional and stores only the parsed credential in the encrypted session envelope. REST capabilities are discovered per session; no REST-backed MCP tool is promoted until account-owner live proof exists. | [`src/scraper/eclass/api/mobile.ts`](../src/scraper/eclass/api/mobile.ts), [`src/scraper/eclass/api/rest.ts`](../src/scraper/eclass/api/rest.ts) |
| eClass item details           |                              60s navigation | Assignment and quiz detail pages get longer because Moodle item pages can be heavier than table/list pages.                                                          | [`src/scraper/eclass/item-details.ts`](../src/scraper/eclass/item-details.ts)   |
| SIS exam/timetable            |                              30s navigation | Exam schedule and timetable list pages use 30s `page.goto` calls.                                                                                                    | [`src/scraper/sis.ts`](../src/scraper/sis.ts)                                   |
| Cengage/WebAssign navigation  |                     Commonly 45s navigation | Dashboard, SSO, direct assignment, and canonical bootstrap paths use longer navigation budgets.                                                                      | [`src/scraper/cengage.ts`](../src/scraper/cengage.ts)                           |
| Cengage assignment-source URL |        30s URL wait, then 7s state fallback | If URL matching times out, the scraper checks page state and may recover if the page is already on dashboard, course, student-home, or assignments.                  | [`src/scraper/cengage.ts`](../src/scraper/cengage.ts)                           |
| Cengage page-state polling    |                  Default 12s, 350ms polling | Page-state detection waits for stable login/dashboard/course/assignment markers. Call sites may use 7-10s narrower budgets.                                          | [`src/scraper/cengage-state.ts`](../src/scraper/cengage-state.ts)               |
| Selector wait helper          |                  Default 15s, 250ms polling | `waitForAnySelector` polls registered selector candidates and reports selector drift on required failure.                                                            | [`src/scraper/selectors/playwright.ts`](../src/scraper/selectors/playwright.ts) |
| RMP HTTP requests             |                     15s default fetch abort | Uses `fetch` with `ECLASS_MCP_RMP_TIMEOUT_MS`; HTTP 429 maps to `RATE_LIMITED`, timeouts map to `TIMEOUT`, invalid JSON and non-OK HTTP map to upstream errors.      | [`src/scraper/rmp.ts`](../src/scraper/rmp.ts)                                   |

## Auth Waits

Visible auth browser time is human-login time, not scraper time. It is intentionally much longer than a normal navigation timeout because York/Cengage login may include MFA or manual account selection.

Tool auth retry waits are shorter. eClass and SIS tools wait for a refreshed encrypted session, retry the original operation once, and return `SESSION_EXPIRED` / `auth_required` if the user does not finish in time. Cengage has the same concept with `ECLASS_MCP_CENGAGE_AUTH_WAIT_MS`, falling back to the eClass wait when unset.

Secure session storage errors are not auth-wait cases. Missing/weak/wrong `ECLASS_MCP_SESSION_SECRET`, malformed secure envelopes, and legacy plaintext sessions return `SESSION_STORAGE_UNAVAILABLE` with `retry.afterAuth=false`.

## Concurrency Model

No global Playwright concurrency limiter exists today.

Most scraper flows create one Playwright page/context per tool operation and close it at the end of that operation. Cengage/WebAssign also tends to process canonical bootstrap candidates sequentially, because each page state affects the next decision.

The stdio runtime installs best-effort shutdown cleanup for MCP disconnects, `SIGINT`, and `SIGTERM`: it closes the local auth HTTP server, visible auth browsers, the eClass browser singleton, and any tracked Cengage/SIS scraper browsers. Signal cleanup waits up to 5 seconds by default; completed cleanup exits normally, while timed-out or failed signal cleanup logs a structured shutdown event and exits non-zero so operators can tell that cleanup was incomplete. This is resource cleanup only; it does not change request concurrency or retry behavior.

The notable bounded fan-out path is `get_deadlines` with `includeDetails=true`: it expands up to `maxDetails` items, defaulting to 7, using `Promise.all`. This is bounded by user/tool input, not by a global scheduler.

The MCP server currently relies on host/tool invocation patterns and per-flow page cleanup rather than a central queue. Future heavier external calls should add explicit per-host concurrency caps before increasing fan-out.

## Cache Health

`cache_health` is a read-only local diagnostic tool. It scans aggregate `.eclass-mcp/cache` and pin-registry state, reports process-local cache counters, and summarizes warnings such as invalid JSON, schema mismatches, stale pinned entries, missing pinned cache files, and pin quota pressure.

The health scan does not delete expired entries, refresh pins, open auth, launch browsers, call upstream services, or expose raw cache filenames, raw cache keys, sensitive URLs, cookies, or absolute local paths.

## Retry And Fallback Behavior

eClass and SIS auth retry opens the local auth route, waits for the saved encrypted session to become valid, then retries the original operation once. A second `SESSION_EXPIRED` returns structured auth guidance instead of looping forever.

Cengage/WebAssign does not blindly retry every timeout. It classifies page state after navigation waits and returns specific outcomes such as `auth_required`, `needs_course_selection`, or `needs_course_activation` when the active WebAssign course does not match the selected course.

File downloads treat WAF reloads as best effort. If the wrapper cannot expose file bytes or a direct file URL, E15 selector/layout diagnostics and E12 upstream errors decide whether the result is drift, timeout, rate limit, or generic upstream failure.

For eClass API reads, `playwright` remains the safe default. `shadow` runs the
API and Playwright paths independently but returns the Playwright result.
Explicit `api` mode uses one bounded Playwright fallback for capability,
malformed-response, timeout, and upstream failures. Valid empty API responses
remain empty; invalid sessions use the normal auth retry; and HTTP 429 returns
`RATE_LIMITED` without immediately adding browser traffic. See the
[canary acceptance record](validation/eclass-hybrid-canary.md).

### Hybrid rollback

Rollback is configuration-only while the branch is being canaried:

1. Set `ECLASS_API_SOURCE_MODE=playwright`.
2. Restart the MCP host.
3. Clear only affected unpinned eClass cache entries if normalized output
   changed; preserve valid account-scoped pins.
4. Confirm that eClass courses/content/deadlines use the existing Playwright
   path and that SIS/Cengage remain unchanged.

Do not delete selectors or remove the Playwright provider as part of an API
promotion. A branch rollback is a separate operator decision and must not
modify the original checkout implicitly.

## Rate Limits

RMP 429 is classified as `RATE_LIMITED`, and repeated RMP upstream failures now open a process-local circuit breaker after 3 consecutive failures. While open, RMP calls fail fast with `RATE_LIMITED` for 60 seconds instead of sending more GraphQL requests.

Successful RMP search/detail responses use cache entries, which reduces repeated calls during normal use. Cache hits do not touch the circuit breaker or RMP network path. When RMP returns HTTP 429, an explicit rate-limit signal, repeated timeouts, or repeated upstream errors, the tool returns structured error JSON instead of sleeping and retrying.

The current engine does not have a global external-HTTP backoff layer. The RMP circuit breaker is intentionally narrow and in-memory; it resets on server restart and does not apply to eClass, SIS, Cengage, or WebAssign browser flows.

## Error Mapping

E12 defines the network-facing machine codes:

- `TIMEOUT`: Playwright/fetch timeout, abort, or HTTP 408/504 where mapped.
- `RATE_LIMITED`: HTTP 429 or explicit rate-limit signal.
- `UPSTREAM_ERROR`: non-timeout, non-rate-limit upstream or parse failure.

Timeouts can also surface as platform-specific outcomes instead of `TIMEOUT` when the scraper can classify the page. For example, Cengage navigation timeout followed by a detected login page should become `auth_required`, while a wrong active WebAssign course should become `COURSE_CONTEXT_MISMATCH`.

## Future Runtime Policy

These are recommended defaults, not currently enforced:

- Add a global browser page concurrency cap of 2-3 pages.
- Add a per-host external HTTP concurrency cap of 1-2 requests.
- Add RMP 429 retry backoff of 1s, 2s, and 4s with jitter, max 3 attempts.
- Consider replacing the current RMP timeout controller with `AbortSignal.timeout(...)` when the supported Node baseline makes that simpler.
- Avoid automatic retry for future non-idempotent write tools unless there is an audit log, explicit safety policy, and cache invalidation story.

Future write tools must not automatically retry non-idempotent operations without an audit log and explicit safety policy.

## Maintainer Checklist

- When adding a new `page.goto`, document its timeout or reuse a documented helper.
- Prefer page-specific readiness markers over `networkidle` on Moodle pages unless there is evidence `networkidle` is stable.
- Map network failures to E12 codes when a tool can return structured JSON.
- Preserve `auth_required` and `needs_course_activation` semantics instead of turning all navigation failures into generic timeouts.
- Keep new fan-out bounded by explicit input limits or a shared concurrency limiter.
- Update this document when adding new external platforms, retry loops, or env-configurable timeout values.
