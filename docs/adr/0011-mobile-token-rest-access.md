# ADR 0011: Moodle Mobile Token REST Access

## Status

Proposed. Pending the account-owner capability probe (see
[findings log](../investigations/eclass-mobile-token-findings.md), open
questions 1–2).

Implementation status (2026-09-27): the parser fix, token REST transport,
token file downloads, capability-gated REST routing (behind the `shadow`
and `api` source modes), mint-after-login, and token-aware startup are in
place with deterministic tests. The status moves to Accepted once the
probe and a live `shadow` session confirm the capability matrix; per-tool
promotion is tracked in
[`eclass-hybrid-release.md`](../validation/eclass-hybrid-release.md).
Autologin (`tool_mobile_get_autologin_key`) is deferred until the probe
shows York issues a private token.

## Context

[ADR 0010](./0010-hybrid-eclass-data-access.md) moved course lists, course
outlines, and deadlines to the session AJAX gateway
(`/lib/ajax/service.php`). The remaining eClass reads (grades, forums,
assignments, `core_course_get_contents`, and files) are rejected on that
gateway with `servicenotavailable`. Moodle exposes them only on the mobile
REST service (`/webservice/rest/server.php`), which needs a Moodle mobile
web service token.

ADR 0010 included a token minter for the official `launch.php` handshake, but
it could not work: it expected `moodlemobile://launch?token=RAW`. Moodle
actually redirects to `moodlemobile://token=<base64(md5(wwwroot + passport)
":::" token [":::" privatetoken])>`, where the payload sits in the URL host
position (findings F1–F2). No tool used the minter, so the defect had no user
impact.

Every remaining eClass read therefore still launches Chromium, navigates
pages, and depends on DOM selectors. The cookie session also expires after
hours to days, which forces a visible Passport York login far more often than
a token would.

## Decision

1. **Mint the mobile token through `launch.php` after SSO.** Parse the real
   redirect format: take the payload after `://token=` without URL parsing,
   decode base64 strictly, split on `:::`, and verify part 0 equals
   `md5(origin + passport)` with a constant-time compare. This binds the
   redirect to the passport this process generated.
2. **Store the token and optional private token only in the encrypted session
   envelope** ([ADR 0002](./0002-secure-session-storage.md)). Never in `.env`,
   cache files, logs, tool output, or fixtures.
3. **Call REST with the token only.** A `fetch`-based transport posts to
   `/webservice/rest/server.php` without a browser context, with the same
   origin assertion, response size cap, timeout, and error categories as the
   Playwright transport. File downloads use `/webservice/pluginfile.php` with
   the token appended only after URL-policy validation.
4. **Route per tool, per capability.** A tool reads REST only when
   `core_webservice_get_site_info` lists the function. Order of preference:
   REST (token) → session AJAX (cookies) → Playwright HTML. The existing
   `playwright` / `shadow` / `api` source modes govern promotion.
5. **On `invalidtoken`, re-mint once** (which requires a valid cookie session),
   then surface `SESSION_EXPIRED` and the visible `/auth` flow.
6. **Read-only.** No REST write function and no `/webservice/upload.php` call
   is added under this ADR.

## Consequences

- **Login frequency** drops from every cookie-session expiry to once per token
  lifetime (Moodle default 12 weeks; York's value to be recorded in the
  findings log).
- **Blast radius:** the token grants every function the mobile service allows
  for this student, for its whole lifetime, without a second factor. It is as
  sensitive as the cookie session and longer-lived. Revocation: sign out via
  `/logout`, reset keys under Preferences → Security keys when shown, and
  rotate `ECLASS_MCP_SESSION_SECRET` if session files may have been copied.
- **Chromium remains required** for Passport York SSO, SIS, Cengage/WebAssign,
  and HTML-only eClass pages. This ADR removes the browser from REST-routed
  reads, not from the product.
- **Two credentials to keep consistent.** Logout and auth-session wipes must
  clear the mobile credential with the cookies.
- Tool output contracts (`src/tools/eclass-contracts.ts`) do not change; REST
  payloads are mapped into the existing types.

## Alternatives considered

- **`/login/token.php` with Passport York credentials.** Rejected: campus login
  is SAML, and posting passwords to that script is outside the product's
  security model (feasibility §15.5).
- **Keep Playwright for everything not on AJAX.** Rejected as the long-term
  path: slow, selector-fragile, and tied to the short cookie lifetime.
- **QR login as the primary mint.** Deferred to ADR 0012 (proposed on the
  `feat/eclass-qr-login` branch) as an opt-in path, because the exchange
  requires presenting a Moodle app user agent.

## References

- [Mobile token findings log](../investigations/eclass-mobile-token-findings.md)
- [Feasibility investigation](../investigations/eclass-official-api-feasibility.md)
- [ADR 0002](./0002-secure-session-storage.md), [ADR 0005](./0005-tool-boundary-structured-errors.md), [ADR 0010](./0010-hybrid-eclass-data-access.md)
- [Moodle `launch.php` (5.1)](https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/launch.php)
