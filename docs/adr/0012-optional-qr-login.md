# ADR 0012: Optional eClass QR Login

## Status

Proposed. Off by default behind `ECLASS_MCP_ENABLE_QR_LOGIN=1`. Moves to
Accepted only after the account owner confirms York's `qrcodetype` setting
and a live exchange (see the
[findings log](../investigations/eclass-mobile-token-findings.md), open
question 3).

## Context

[ADR 0011](./0011-mobile-token-rest-access.md) mints the Moodle mobile token
after a visible Passport York login. Moodle also offers a QR login for its
mobile app: the profile page shows a QR code whose payload is
`moodlemobile://https://<site>?qrlogin=<key>&userid=<id>` when the site sets
`qrcodetype` to login (finding F6). The app exchanges it with
`tool_mobile_get_tokens_for_qr_login`, which is callable through
`/lib/ajax/service-nologin.php` without a session (F8).

Moodle requires the caller's user agent to contain `MoodleMobile`, HTTPS,
a non-admin user, and a single-use key that expires after 10 minutes and may
be bound to the generating IP address (F7). The key is shown only to a
signed-in account owner.

## Decision

1. **Opt-in only.** `ECLASS_MCP_ENABLE_QR_LOGIN=1` enables `GET/POST /auth-qr`
   on the localhost auth server. When unset, the route returns the same 404 as
   any unknown path and the root page does not link to it.
2. **The owner pastes the payload.** The page is a form (same-origin check
   plus the per-server CSRF nonce used by `/logout`). The server does not scan
   cameras or screens.
3. **Strict parsing.** `parseQrLoginPayload` accepts exactly two forms: the
   profile payload `moodlemobile://https://<site>?qrlogin=<key>&userid=<id>`,
   and the same `https://` URL without the app scheme (what many QR readers
   show). Any other outer scheme is rejected. It requires HTTPS, the
   configured eClass origin (no other port, no user info), an alphanumeric
   key of 8–128 characters, and a positive integer user id.
4. **One exchange, no retries.** `exchangeQrLogin` posts one AJAX batch with
   user agent `MoodleMobile`, `redirect: 'error'`, the eClass API timeout, and
   a 64 KiB response cap. A response without a well-formed token fails; a
   malformed private token is dropped, not stored.
5. **Verify before storing.** The new token alone (held in memory) reads
   `core_webservice_get_site_info` over the cookie-free REST transport, and
   the user id must equal the one in the QR payload; otherwise nothing is
   saved (`identity_mismatch`).
6. **Replace account state atomically.** If the active account scope is
   already this user, the token is added to the existing envelope and the
   cookies are kept. Otherwise the envelope is replaced by a token-only one,
   API browser contexts are closed, the previous account's caches are
   cleared, and the account scope moves to the QR user. Both paths advance
   the auth generation, so a token renewal in flight cannot overwrite it.
7. **Explicit error mapping.** `qrcodedisabled`, `apprequired`, `invalidkey`,
   `expiredkey`, IP mismatch, `autologinnotallowedtoadmins`, and disabled
   mobile services each map to a fixed message that points back to `/auth`.
   Moodle's own message text is never echoed.
8. **Nothing sensitive is logged.** Only `{ event: 'qr_login_exchange',
outcome }` and `{ event: 'qr_login_applied', transition }` are logged; `qrlogin`/`qrloginkey` query values are also covered
   by `src/logging/redact.ts`.

## Consequences

- **Presenting a Moodle app user agent** is the reason this is opt-in. It is
  the documented contract of the function Moodle ships for this purpose, the
  owner authorizes each exchange with a key only they can see, and it does not
  bypass any authentication. Owners who prefer not to present it keep `/auth`.
- **QR login creates no cookie session.** Only `ECLASS_API_SOURCE_MODE=api`
  serves reads from the token alone; `shadow` needs cookies too. SIS,
  Cengage/WebAssign, section text, item details, and assignment preflight
  still need `/auth`. A
  token-only envelope stores its cookie timestamp as the epoch, so it never
  counts as a fresh cookie session.
- **Re-mint on `invalidtoken` still needs cookies** (ADR 0011 §5); after a
  QR-only login a rejected token surfaces `SESSION_EXPIRED`.
- If York does not set `qrcodetype` to login, every exchange fails with
  `qr_login_disabled` and the feature has no effect.

## Alternatives considered

- **Make QR login the default mint.** Rejected: it depends on a site setting
  we have not observed and on the app user agent.
- **Decode the QR image server-side.** Rejected: adds an image dependency and
  a larger input surface for no security benefit.

## References

- [Mobile token findings log](../investigations/eclass-mobile-token-findings.md) (F6–F8)
- [ADR 0002](./0002-secure-session-storage.md), [ADR 0011](./0011-mobile-token-rest-access.md)
- [Moodle `tool_mobile` external functions (5.1)](https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/classes/external.php)
