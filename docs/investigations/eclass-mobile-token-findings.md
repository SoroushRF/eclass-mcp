# eClass mobile token findings log

**Status:** Open. Updated as findings are made.
**Started:** 27 September 2026
**Site:** York University eClass (`https://eclass.yorku.ca`, Moodle 5.1)
**Related:** [ADR 0011 — Moodle mobile token REST access](../adr/0011-mobile-token-rest-access.md), [ADR 0010](../adr/0010-hybrid-eclass-data-access.md), [feasibility investigation](./eclass-official-api-feasibility.md)

## Purpose

This log records what is known about minting and using a Moodle mobile web
service token for the account owner's own eClass account. It covers the
`launch.php` handshake, the mobile REST function set York exposes, token
lifetime, token-authenticated file downloads, and the optional QR login
exchange.

It is a working log, not a design document. Decisions live in the ADRs.

## Method

Findings come from three sources:

- **Moodle source** at the `MOODLE_501_STABLE` branch (Moodle 5.1 moved
  plugin code under `public/`).
- **Automated tests** in this repository, built from Moodle's exact
  construction with fake values.
- **Account-owner live checks**: the owner runs a local command or uses
  browser DevTools (logged in, Network tab, Preserve log) against their own
  account on their own machine.

## Evidence handling

These rules extend §2.4 and §15 of the
[feasibility investigation](./eclass-official-api-feasibility.md) and the
documentation rule in [CONTRIBUTING.md](../../CONTRIBUTING.md#documentation-rule).

- Never record tokens, private tokens, QR login keys, `sesskey`, cookies,
  `Location` header values, numeric user ids, student numbers, or emails.
- Record **shapes** only: lengths, character classes, field names, counts,
  HTTP status codes, and Moodle error codes.
- Mark every claim with an evidence class:
  - **Observed**: seen on the owner's own account, with date and method.
  - **Source**: read in Moodle code or official documentation (linked).
  - **Assumed**: expected but not yet verified.

## Findings

| # | Date | Method | Observation | Evidence class |
| --- | --- | --- | --- | --- |
| F1 | 2026-09-27 | Read [`launch.php`][launch] | After `require_login`, Moodle builds `base64(md5($CFG->wwwroot . passport) . ':::' . token [. ':::' . privatetoken])` and redirects to `<urlscheme>://token=<that value>`. The default `urlscheme` is `moodlemobile`; the site setting `forcedurlscheme` can override it. | Source |
| F2 | 2026-09-27 | Read [`launch.php`][launch] | Because the payload follows `://token=` directly, a WHATWG URL parser treats `token=<base64>` as the **host**. `new URL(location).searchParams.get('token')` is therefore always `null`. The original parser in `mobile.ts` could not work against a real redirect. | Source |
| F3 | 2026-09-27 | Read [`launch.php`][launch] | The private token is appended only when HTTPS is used, the user is not a site admin (`moodle/site:config`), and either the user just logged in (`$SESSION->justloggedin`) or the token was newly created in this request. Otherwise the payload has two parts. | Source |
| F4 | 2026-09-27 | Read [`launch.php`][launch] | When `confirmed=1` is passed or the user agent is iOS, Moodle returns an HTML page with a link `id="launchapp"` that is auto-clicked by script. Other user agents receive a `Location` header. | Source |
| F5 | 2026-09-27 | Read [`launch.php`][launch] | `launch.php` sets a `tool_mobile_launch` cookie (15 minutes) before `require_login` and clears it afterwards. | Source |
| F6 | 2026-09-27 | Read [`api.php`][api] | The profile QR payload is `<urlscheme>://<wwwroot>?qrlogin=<key>&userid=<id>` when `qrcodetype == 2` (`QR_CODE_LOGIN`). The key type is `tool_mobile/qrlogin`; previous keys are deleted on each generation. The key is IP-restricted when `qrsameipcheck` is enabled. | Source |
| F7 | 2026-09-27 | Read [`external.php`][external] | `tool_mobile_get_tokens_for_qr_login(qrloginkey, userid)` requires `qrcodetype == 2` (`qrcodedisabled` otherwise), a user agent containing `MoodleMobile` (`apprequired` otherwise), HTTPS, and a non-admin user (`autologinnotallowedtoadmins`). It validates and deletes the key, requires an active user, and returns `token`, `privatetoken` (may be empty), and `warnings`. | Source |
| F8 | 2026-09-27 | Read [`db/services.php`][services] | `tool_mobile_get_tokens_for_qr_login` is declared `'ajax' => true` and `'loginrequired' => false`, so it is callable through `/lib/ajax/service-nologin.php` without a session. | Source |
| F9 | 2026-09-27 | Read [`db/services.php`][services] | `tool_mobile_get_autologin_key` is a `write` function in the mobile service. Its description states it works only over HTTPS, is restricted by time and IP address, and requires a Moodle app user agent. | Source |
| F10 | 2026-09-27 | Read [`useragent.php`][useragent] | `core_useragent::is_moodle_app()` is a case-insensitive substring match for `MoodleMobile` in the user agent. | Source |
| F11 | 2026-09-27 | Moodle docs | Web service file downloads use `/webservice/pluginfile.php/...` with a `token` query parameter. Uploads use `/webservice/upload.php` (out of scope for this read-only engine). | Source |
| F12 | 2026-09-27 | Moodle docs | Token lifetime is admin-configurable (`tokenduration`, Moodle default 12 weeks). | Source |

## Open questions

1. Which mobile REST functions does York expose to a student token? Run
   `npm run probe:mobile` and commit the result to
   [`docs/validation/eclass-mobile-rest-capabilities.md`](../validation/eclass-mobile-rest-capabilities.md).
2. What is York's token lifetime? Check `/user/managetoken.php` after a mint.
3. Is `qrsameipcheck` enabled on York's site?
4. Does `/user/managetoken.php` show a "Moodle mobile web service" row after
   a mint?
5. Does the token shape on York match Moodle's default (32 lowercase hex
   characters)?
6. Is a private token issued when minting from an existing (not freshly
   logged-in) session? F3 predicts no after the first mint.
7. Does the AWS WAF challenge appear on `/webservice/pluginfile.php`?
   Expected: no.

## References

- [`admin/tool/mobile/launch.php`](https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/launch.php)
- [`admin/tool/mobile/db/services.php`](https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/db/services.php)
- [`admin/tool/mobile/classes/external.php`](https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/classes/external.php)
- [`admin/tool/mobile/classes/api.php`](https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/classes/api.php)
- [`lib/classes/useragent.php`](https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/lib/classes/useragent.php)
- [Moodle: Creating a web service client](https://docs.moodle.org/dev/Creating_a_web_service_client)
- [Moodle app guide for admins](https://docs.moodle.org/500/en/Moodle_app_guide_for_admins)

[launch]: https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/launch.php
[services]: https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/db/services.php
[external]: https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/classes/external.php
[api]: https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/admin/tool/mobile/classes/api.php
[useragent]: https://github.com/moodle/moodle/blob/MOODLE_501_STABLE/public/lib/classes/useragent.php
