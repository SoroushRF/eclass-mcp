# eClass official API feasibility investigation

**Status:** Investigation complete enough to choose an architecture. Implementation is not started.  
**Dates:** 13 August 2026  
**Site:** York University eClass (`https://eclass.yorku.ca`)  
**Product under study:** this repository’s local MCP server (`eclass-mcp`)  
**Related ADR:** [ADR 0010 — Hybrid eClass data access (session JSON + optional mobile handshake)](../adr/0010-hybrid-eclass-data-access.md)

This document records the full investigation that asked whether York eClass can be consumed through official machine-readable interfaces instead of Playwright HTML scraping, in the same spirit as a friend’s UTSC MCP that talks to Quercus through documented APIs and an account-settings token.

It is written for future maintainers. It is deliberately long. It includes failed probes, dead ends, operational gotchas, security rules, and the mapping from each current MCP tool to a future access path.

---

## 1. Purpose and questions

### 1.1 Why this investigation existed

The current engine uses Playwright (a real Chromium browser) for almost all York data:

- A **visible** browser for Passport York login.
- A **headless** browser that reuses saved cookies, opens eClass pages, waits for CSS selectors, and extracts text from the DOM.

That design works, but it is heavy to run and deploy: Chromium must be installed, pages are slow, selectors break when the theme or Moodle version changes, and a future packaged product would have to ship a browser.

A friend built a similar MCP for UTSC’s online learning platform. That system does **not** scrape pages. It calls HTTP APIs using a token the student creates in account settings.

The question was: **can eClass be treated the same way?**

### 1.2 Questions the investigation set out to answer

1. What product is eClass, and what official APIs does that product normally expose?
2. Does York actually turn those APIs on for students?
3. Is there a student-visible “create a token in settings” control comparable to UTSC?
4. If not, are there other official token or session paths (mobile app, QR login, launch URLs)?
5. Can a logged-in browser session call the same functions the website itself uses, without reading HTML?
6. Which current MCP tools could switch to structured responses, and which still need a browser?
7. What must never be logged, committed, or pasted into chat?

### 1.3 What this investigation was not

- It was not a penetration test, credential stuffing exercise, or attempt to access anyone else’s data.
- It did not bypass Passport York, Shibboleth, or Moodle permissions.
- It did not implement the new architecture.
- It did not change production code paths.
- It did not store tokens, session keys, cookies, or personal identifiers in this document.

All logged-in checks were performed by the account owner in their own browser. Unauthenticated checks hit only endpoints Moodle publishes for the mobile app and for token/error discovery.

---

## 2. Method

Work proceeded in layers, from public knowledge to a logged-in student session.

### 2.1 Layer A — Product identification and public documentation

- Compare UTSC’s platform (Quercus / Canvas LMS) with York eClass.
- Read York Learning Technology Services documentation for the Moodle mobile app.
- Read Moodle’s public documentation for web services, the official mobile app, and `launch.php`.

### 2.2 Layer B — Unauthenticated live probes against `eclass.yorku.ca`

Performed from a development machine **without** student credentials. The goal was to see whether endpoints exist and what error codes they return when required parameters are missing.

Probed URLs included:

- `https://eclass.yorku.ca/`
- `https://eclass.yorku.ca/eclass/`
- `https://eclass.yorku.ca/login/index.php`
- `https://eclass.yorku.ca/eclass/login/index.php`
- `https://eclass.yorku.ca/login/token.php`
- `https://eclass.yorku.ca/eclass/login/token.php`
- `https://eclass.yorku.ca/webservice/rest/server.php`
- `https://eclass.yorku.ca/lib/ajax/service.php` (POST of the public mobile-config function)
- `https://eclass.yorku.ca/admin/tool/mobile/launch.php`

A single request to `login/token.php` used obviously fake username/password values only to distinguish “this script does not exist” from “this script ran an authentication check.” No real Passport York password was sent from the investigation harness.

### 2.3 Layer C — Logged-in browser DevTools

The account owner, already signed into eClass in Chrome:

- Filtered the Network tab to `service.php` on My courses, a sample course home, Grades, and other shell pages.
- Ran console snippets against `M.cfg` and against `/lib/ajax/service.php`.
- Opened Preferences, Security keys, and the profile Mobile app section.
- Walked `launch.php` through its required-parameter errors and then through a successful redirect.

### 2.4 Rules for evidence handling

- Do not record cookies, `sesskey` values, RSS keys, mobile tokens, `Location` headers that contain `token=`, student numbers, emails, or Moodle numeric user ids in this file.
- Record **shapes**: HTTP status, error codes, function names, field names, counts, and yes/no existence of UI.
- Treat any mobile token or RSS key as equivalent to a password for the lifetime of that key (see §15).

---

## 3. Current architecture (the design we compared against)

This is the engine as of `1.0.0-beta.3`, documented in [`PROJECT_MASTER.md`](../PROJECT_MASTER.md) and [`docs/adr/0001-local-first-mcp.md`](../adr/0001-local-first-mcp.md).

### 3.1 Local-first MCP

The server runs on the student’s machine and talks to Claude Desktop or Codex Desktop over stdio. There is no project-owned cloud relay. Authenticated URLs are allowlisted in `src/security/url-policy.ts`. Sessions are encrypted at rest ([ADR 0002](../adr/0002-secure-session-storage.md)).

### 3.2 How eClass data is collected today

1. The user opens a local auth URL; Playwright launches a **visible** Chromium window.
2. The user completes Passport York / Shibboleth login.
3. All cookies for the context are saved encrypted to `.eclass-mcp/session.json`.
4. Later tool calls create a **headless** context, inject those cookies, `page.goto` a Moodle URL, wait for selectors (Moove theme / Moodle 4–5 dashboard cards, `#region-main`, assignment tables, and so on), and parse the DOM.
5. Results are cached on disk with TTLs ([ADR 0003](../adr/0003-file-cache.md)). Selector drift is a first-class failure mode ([ADR 0004](../adr/0004-selector-registry.md)).

`ECLASS_URL` defaults to `https://eclass.yorku.ca`.

### 3.3 Tool families that depend on this

| Family | Tools (representative) | Upstream |
| --- | --- | --- |
| eClass catalog | `list_courses`, `get_course_content`, `get_section_text` | eClass HTML |
| eClass time | `get_deadlines`, `get_upcoming_deadlines`, `get_item_details` | eClass HTML |
| eClass marks and news | `get_grades`, `get_announcements` | eClass HTML |
| eClass files | `get_file_text` | eClass file wrapper + `pluginfile.php` |
| eClass assignments | `get_assignments` (eClass half), `prepare_assignment_submission` | eClass HTML |
| SIS | `get_exam_schedule`, `get_class_timetable` | `w2prod.sis.yorku.ca` HTML |
| Cengage / WebAssign | `discover_cengage_links`, `list_cengage_courses`, `get_cengage_assignments`, `get_cengage_assignment_details` | Cengage HTML after eClass discovery |
| RMP | `search_professors`, `get_professor_details` | HTTP JSON (already not Playwright-for-eClass) |
| Cache | `clear_cache`, `cache_health`, pin tools | local disk |

The pain of the current design is concentrated in the **eClass HTML** rows. SIS and Cengage are separate products and were never expected to ride an eClass API.

### 3.4 Why scraping is costly here

Operational notes already in [`operational-limits.md`](../operational-limits.md):

- My courses: 60s navigation, 20s DOM settle, waiting for course cards **or** a settled empty dashboard.
- Course content: 60s navigation; `networkidle` is avoided because Moodle background requests never go idle.
- Grades, announcements, section text, item details: tens of seconds each, plus selector registries.
- File wrappers: AWS WAF challenge reload is best-effort.
- No global Playwright concurrency limiter.

An official JSON path removes layout wait, selector drift, and a large fraction of Chromium use for those tools. It does not remove Passport York.

---

## 4. What UTSC actually is (the friend’s model)

UTSC’s student LMS is **Quercus**, which is **Canvas LMS** (Instructure).

Canvas’s student-facing integration model, documented by Instructure and used by multiple public UTSC/UofT helper projects, is:

1. Log in to Quercus.
2. Account → Settings → Approved Integrations → New Access Token.
3. Store that token locally.
4. Call Canvas REST: `https://<host>/api/v1/...` with an `Authorization: Bearer` header.

That is a first-class, documented, copy-paste token UX. Canvas also has a full OAuth2 flow for multi-user apps; students still commonly mint a personal token for local tools.

**This is not what eClass is.** Treating York as “the same as Quercus, just find the Settings button” was the first hypothesis. It is false. The *idea* (official HTTP + a user-scoped credential) is still the right target. The *product mechanics* are Moodle’s, not Canvas’s.

---

## 5. What eClass actually is

### 5.1 Product

York eClass is **Moodle**, sitename `eClass`, public `wwwroot` `https://eclass.yorku.ca`.

York UIT / Learning Technology Services documents that students can use the **official Moodle mobile app** against this site. Historical help text tells students to enter `http://eclass.yorku.ca/eclass` as the site name, then Passport York username and password. Live public config (below) is more precise: mobile login is **embedded-browser SSO**, not a password typed into the app chrome.

Sources:

- [York UIT Learning Technologies](https://www.yorku.ca/uit/student-services/learning-technologies/)
- [York LTS: How do I use the Mobile App?](https://lthelp.yorku.ca/mobile-app)
- [Moodle: creating a web service client](https://docs.moodle.org/dev/Creating_a_web_service_client)
- [Moodle: web service API functions](https://docs.moodle.org/dev/Web_service_API_functions)
- [Moodle app guide for admins](https://docs.moodle.org/500/en/Moodle_app_guide_for_admins)

### 5.2 Version signal

A logged-in error page linked to Moodle docs under `/501/`, i.e. **Moodle 5.1**. Unauthenticated REST exceptions used the namespaced class `core\exception\moodle_exception`, which matches modern Moodle, not Moodle 3.x.

The site theme in `M.cfg.theme` is **`moove`**. The current Playwright scraper already assumes Moove / Moodle 4+ dashboard markup. An API migration would retire much of that assumption for the tools that move off HTML.

### 5.3 URL prefix `/eclass`

UIT docs mention `eclass.yorku.ca/eclass`. Live probes showed `/` and `/eclass/` both exist and both send unauthenticated browsers to Shibboleth. Public config `wwwroot` is **`https://eclass.yorku.ca` without a subdirectory**. The MCP `ECLASS_URL` default is therefore correct. `/eclass` is a compatibility alias, not a second Moodle.

---

## 6. Layer B findings (no student login)

### 6.1 Browser login is Shibboleth

Unauthenticated GET of `/`, `/eclass/`, `/login/index.php`, and `/eclass/login/index.php` all redirected to:

`https://shib.yorku.ca/idp/profile/SAML2/Redirect/SSO?...`

Title: “York University - Shibboleth - Loading Session Information”.

Human login is **Passport York SAML**, not a Moodle-native username/password form as the primary path.

### 6.2 Token script exists

`GET /login/token.php` (and the `/eclass/login/token.php` alias) returned JSON:

```text
errorcode: missingparam
error: A required parameter (username) was missing
```

That is Moodle’s official token-minting script, used by the mobile app on sites that allow in-app password login.

A follow-up with fake username/password and `service=moodle_mobile_app` (also tried `moodle_mobile` and `local_mobile`) returned:

```text
errorcode: invalidlogin
error: Invalid login, please try again
```

Interpretation:

- The script is live and runs an auth check.
- `invalidlogin` does **not** prove that real Passport York passwords would succeed. Public config (next section) says mobile login type is embedded browser / SSO. York may still have a leftover password path, but **this investigation does not recommend sending Passport York passwords to `token.php`.** The supported student path is SAML, then the mobile launch handshake.

### 6.3 REST server exists and is enabled

`GET /webservice/rest/server.php` returned XML (and JSON when `moodlewsrestformat=json`):

```text
errorcode: invalidtoken
message: Invalid token - token not found
```

If web services were disabled, Moodle typically says so explicitly or 404s. `invalidtoken` means: **the REST door is on; it is waiting for a valid web-service token.**

Calling `tool_mobile_get_public_config` on the REST server **without** a token also returned `invalidtoken`. That public function is meant to be called via the **AJAX** gateway, not REST without a token.

### 6.4 AJAX gateway exists

`GET /lib/ajax/service.php?info=tool_mobile_get_public_config` without a JSON body:

```text
errorcode: codingerror
error: Invalid json in request: Syntax error
```

The script exists and expects a JSON POST body (Moodle’s batched `{index, methodname, args}` array).

### 6.5 Public mobile config (the most important unauthenticated result)

POST to `/lib/ajax/service.php` with:

```json
[{"index":0,"methodname":"tool_mobile_get_public_config","args":{}}]
```

returned `error: false` and a data object. Fields that matter, with values as observed:

| Field | Observed value | Meaning |
| --- | --- | --- |
| `wwwroot` | `https://eclass.yorku.ca` | Canonical site URL |
| `sitename` | `eClass` | Branding |
| `enablewebservices` | `1` | Web services are on |
| `enablemobilewebservice` | `1` | Official mobile service is on |
| `typeoflogin` | `3` | Moodle constant `LOGIN_VIA_EMBEDDED_BROWSER` — app opens the site login (SSO) inside a webview, then exchanges for a token |
| `launchurl` | `https://eclass.yorku.ca/admin/tool/mobile/launch.php` | Official post-SSO token handshake |
| `tool_mobile_minimumversion` | `5.2.1` | App version York wants |
| `tool_mobile_iosappid` | `633359593` | Official Moodle iOS app |
| `tool_mobile_androidappid` | `com.moodle.moodlemobile` | Official Moodle Android app |
| `tool_mobile_qrcodetype` | `2` | QR **login** enabled (not merely a URL QR) |
| `tool_mobile_disabledfeatures` | empty string | York has not stripped mobile features in this public list |
| `showloginform` | `1` | Login form still advertised |
| `identityproviders[0].name` | `Login via PPY with SAML` | Passport York SAML is the IdP |
| `identityproviders[0].url` | `https://eclass.yorku.ca/auth/saml2/login.php?...` | SAML2 plugin |
| `forgottenpasswordurl` | York computing password-reset URL | Passwords are Passport York, not Moodle-local |
| `authinstructions` | HTML telling students/staff to use Passport York | Confirms campus IdP |
| `guestlogin` | `0` | No guest |
| `maintenanceenabled` | `0` | Site not in maintenance at probe time |

`typeoflogin` constants (Moodle `tool_mobile\api`):

- `1` = login via the app (username/password in app UI)
- `2` = login via an external browser window
- `3` = login via an **embedded** browser

York is **3**. Combined with a SAML identity provider, the intended mobile flow is: open eClass login in a webview → Passport York → Moodle mints a mobile token → return to the app.

### 6.6 `launch.php` exists

Bare GET `/admin/tool/mobile/launch.php` in a logged-in session later returned Moodle’s standard “A required parameter (service) was missing.” The endpoint is real. It is not an admin-only dead page; the `admin/tool/mobile/` path is the plugin location, not a requirement that the caller be a site administrator.

---

## 7. Layer C findings (logged-in student session)

### 7.1 `M.cfg` (Moodle’s page JavaScript config)

Safe fields observed on the dashboard:

| Key | Observation |
| --- | --- |
| `wwwroot` | `https://eclass.yorku.ca` |
| `theme` | `moove` |
| `courseId` | `1` on dashboard / site home (Moodle’s site course) |
| `userid` (all lowercase) | **undefined** on the dashboard |
| `userId` (camelCase) | **present** — this is the numeric Moodle user id |
| `sesskey` | present; length 10 characters |
| `usertimezone` | `America/Toronto` |

A `data-userid` attribute on the page matched `M.cfg.userId`.

**Do not log `sesskey`.** It is a CSRF token bound to the HTML session. It is required to call `/lib/ajax/service.php` but it is not a long-lived API key.

**Do not log the numeric user id in tickets or git.** It is an internal identifier. Code should read it at runtime from `M.cfg.userId` or from a site-info call.

### 7.2 Network tab: what the website already calls

Filter: `service.php`, Fetch/XHR. Observed `methodname` values:

| methodname | Where | Role |
| --- | --- | --- |
| `core_course_get_enrolled_courses_by_timeline_classification` | My courses | The JSON behind the course overview. This is what Playwright currently waits to appear as cards in the DOM. |
| `core_courseformat_get_state` | Course home (and still visible on some other tabs as leftover) | Moodle 5 course-format state: course, sections, course modules |
| `core_message_get_unsent_message` | Shell chrome on many pages | Draft message; ignore for MCP |
| `core_message_get_unread_conversations_count` | Shell chrome | Notification badge; ignore for MCP |
| `local_savy_launchsavy` | Shell / course chrome | **York custom plugin** (`local_savy`). Out of scope unless a future tool needs Savy |

Payload shape (every call):

```json
[
  {
    "index": 0,
    "methodname": "<frankenstyle_function_name>",
    "args": { }
  }
]
```

Query string includes `sesskey` and often `info=<methodname>`.

This is Moodle’s standard AJAX batch gateway: `POST /lib/ajax/service.php?sesskey=...` with `Content-Type: application/json`.

### 7.3 Enrolled courses via AJAX — success

Calling `core_course_get_enrolled_courses_by_timeline_classification` with:

```text
classification: all
limit: 0
offset: 0
sort: fullname
```

returned **29 courses**. Sample object keys: `id` (integer), `fullname`, `shortname`.

This is a complete replacement for scraping `/my/courses.php` for `list_courses`.

### 7.4 Course format state — success

On a sample undergraduate course, `core_courseformat_get_state` with `args.courseid` set to that course’s integer id returned `error: false`.

Important encoding detail: `data` was a **JSON string**, not a nested object. Clients must `JSON.parse` once.

Parsed shape (field names only; module titles are ordinary course content):

```text
course: { id, numsections, sectionlist[], editmode, highlighted, baseurl, statekey, maxbytes, maxbytestext }
section[]: { id, section, number, title, hassummary, rawtitle, cmlist[], visible, current, indexcollapsed, contentcollapsed, hasrestrictions, sectionurl, ... }
cm[]: { id, anchor, name, visible, stealth, sectionid, sectionnumber, uservisible, modname, module, plugin, url?, ... }
```

Example modules in the general section: a label (“Text and media area”, `mod_label`) and Announcements (`mod_forum`) with a `mod/forum/view.php?id=` URL.

`sectionlist` in that snapshot contained the general section only, while `numsections` was 2. Heavier courses may lazy-load additional sections through more `courseformat` calls. Maintainers should watch the Network tab while expanding sections before assuming one `get_state` call is the entire outline.

This is the browser-native replacement for a large part of `get_course_content` scraping. It is **not** the same function as `core_course_get_contents` (see §7.6).

### 7.5 `core_course_get_contents` via AJAX — not available

The same session, same `sesskey`, calling `core_course_get_contents` with that course id returned:

```text
errorcode: servicenotavailable
message: Web service is not available. (It doesn't exist or might be disabled.)
```

Docs link used Moodle 5.1 (`/501/`).

This is the central architectural split:

- **AJAX gateway** (`/lib/ajax/service.php`) only runs functions Moodle marks as AJAX-callable for the web UI.
- **Mobile REST** (`/webservice/rest/server.php`) runs the `moodle_mobile_app` function set, which includes `core_course_get_contents`, `mod_assign_get_assignments`, `mod_forum_get_forums_by_courses`, `gradereport_user_get_grade_items`, and many others.

`servicenotavailable` on AJAX does **not** mean York disabled the function for the mobile app. It means **the website is not allowed to call it that way.**

### 7.6 AJAX availability matrix (logged-in)

A batch of probes produced:

| methodname | AJAX ok? | errorcode if not | summary of success payload |
| --- | --- | --- | --- |
| `core_calendar_get_calendar_upcoming_view` | yes | — | object, 7 keys |
| `core_calendar_get_action_events_by_timesort` | yes | — | object, 3 keys |
| `core_courseformat_get_state` | yes | — | object, 3 keys (stringified JSON inside `data` as in §7.4) |
| `core_course_get_enrolled_courses_by_timeline_classification` | yes (earlier dedicated call) | — | 29 courses |
| `gradereport_user_get_grade_items` | no | `servicenotavailable` | — |
| `mod_forum_get_forums_by_courses` | no | `servicenotavailable` | — |
| `mod_assign_get_assignments` | no | `servicenotavailable` | — |
| `core_enrol_get_users_courses` | no | `servicenotavailable` | — |
| `core_course_get_contents` | no | `servicenotavailable` | — |

`core_enrol_get_users_courses` is redundant for us: the timeline-classification call already lists courses.

Grades, forums, and assignments **as named mobile functions** are not on the AJAX gateway. The Grades **page** itself appeared to be server-rendered HTML (User report table). Network on that tab still showed courseformat/messaging calls, not a grade web service.

### 7.7 Calendar event counts

A follow-up that logged `events.length` and types for:

- `core_calendar_get_calendar_upcoming_view` with `courseid: 1` (site home)
- `core_calendar_get_action_events_by_timesort` with `timesortfrom: now` and `limitnum: 50`

returned:

```text
upcoming: 0
action: 0
types: empty
```

This is a **successful empty result**, not `servicenotavailable`. At the time of the probe (August 2026) the visible credit courses were Winter 2025–2026, i.e. already finished. An empty “upcoming from now” site calendar is plausible.

Before implementing deadline tools on this path, re-probe:

- with a **current** course id
- with `timesortfrom` in the past if historical items are required
- with `core_calendar_get_calendar_monthly_view` for a specific month
- after confirming `data.events` vs other keys (the first matrix counted object keys, not events)

### 7.8 Account UI: Security keys, Preferences, profile QR

**Preferences** (`/user/preferences.php`) listed, under User account:

- Edit profile, Preferred language, Forum preferences, Editor preferences, Calendar preferences, Content bank preferences, **Security keys**, Message preferences, Notification preferences

There is **no** Canvas-style “New Access Token” / “Approved Integrations” block.

**Security keys** (`/user/managetoken.php`) showed **RSS** only: an explanation that RSS URLs contain a user token, plus Reset. There was **no** “Moodle mobile web service” token row visible to this student at the time of the first visit.

Interpretation:

- The page exists, so some user-key features are on.
- RSS keys are **not** mobile REST tokens. They only authorize RSS feeds.
- Students on this site do **not** get the friend’s Quercus UX.
- Moodle only shows mobile tokens on this page if the user has `moodle/webservice:createtoken` (and related) capabilities **and** a token has been generated. York’s student role appears not to expose a copyable mobile token here, or only exposes it after the app handshake (unverified — reload this page after a successful `launch.php` during implementation, but never commit the key).

**Profile** (`/user/profile.php`) Mobile app section:

- “QR code for mobile app access”
- “Scan the QR code with your mobile app and you will be automatically logged in. The QR code will expire in 10 mins.”
- Button: View QR code
- Footer: “This site has mobile app access enabled.”

That matches public config `tool_mobile_qrcodetype = 2`. QR login is an official student-facing token mint into the Moodle app, not a string York prints on the page for `.env`.

### 7.9 `launch.php` walk-through (the Path A handshake)

Sequence actually observed:

1. GET `/admin/tool/mobile/launch.php`  
   Error: **A required parameter (service) was missing.**

2. GET `/admin/tool/mobile/launch.php?service=moodle_mobile_app`  
   Error: **A required parameter (passport) was missing.**  
   `passport` is a nonce the official app generates. Using a dummy integer (for example `1`) is enough for a probe.

3. Pasting the full URL with `service` and `passport` while **logged out** sent the browser to Shibboleth (normal). Completing login *on that URL* is a bad idea: SAML `RelayState` / `wantsurl` often **drops the query string**, returning to bare `launch.php` and error (1) again.

4. Pasting the full URL in Chrome or Edge while a **custom protocol redirect** is about to fire can look like “the tab did not navigate.” Chromium does not paint a new document for `moodlemobile://`. YouTube, new tab, and eClass all appear unchanged. This is not a broken URL.

5. Shibboleth mid-flow URLs such as  
   `/idp/profile/SAML2/Redirect/SSO?execution=e2s1&_eventId_proceed=1`  
   are **single-use**. Opening a second login tab, refreshing, or GETting `_eventId_proceed` produces a **blank page**. Recovery: close every `eclass.yorku.ca` and `shib.yorku.ca` tab, start only from `https://eclass.yorku.ca`, finish Passport York once.

6. Correct probe, already logged in, new tab, DevTools Network, **Preserve log** checked, full URL:  
   `/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=1`

   Observed:

   - Request method: GET
   - Status: **302 Found**
   - Response header `Location`: scheme **`moodlemobile://`**, and the path/query includes a **`token=`** parameter (value omitted from this document)
   - A follow-up row in Network failed (browser cannot open the custom scheme without the Moodle app registered)
   - Cookies named `tool_mobile_launch` were set as part of the handshake (do not log)

**This is the official Moodle app token issuance flow, used after SSO, on a student account.** It is the York analogue of “I created a token in settings,” except the token is delivered to the app URL scheme instead of a settings text box.

For a local MCP, the same handshake can be performed after the existing Playwright (or visible) SSO session: request `launch.php` with `service=moodle_mobile_app` and a random `passport`, read the `Location` header, and keep the credential in the already-encrypted session store. Implementation must never print that header.

---

## 8. Two gateways (do not mix them up)

```text
Passport York SAML  -->  Moodle session cookies
                            |
                            +--> /lib/ajax/service.php  + sesskey
                            |       only AJAX-flagged functions
                            |       proven: courses, courseformat, calendar
                            |
                            +--> /admin/tool/mobile/launch.php
                                    302 moodlemobile://token=...
                                    |
                                    +--> /webservice/rest/server.php + wstoken
                                            mobile function set
                                            expected: contents, grades, forums, assigns
                                            (REST door proven live; function set not yet
                                             called with a token in this investigation)
```

| Gateway | Auth | Proven in this investigation |
| --- | --- | --- |
| `/lib/ajax/service.php` | Cookies + `sesskey` | Courses list, course format state, calendar upcoming + action events |
| `/webservice/rest/server.php` | `wstoken` query/body param | Door is live (`invalidtoken` without a key). Full mobile function list **not** exercised with a real token here (intentionally: tokens must not be pasted or checked into git) |
| `/login/token.php` | username + password + `service` | Script live; SSO site; **do not use Passport passwords here** as the primary design |
| `/admin/tool/mobile/launch.php` | Existing Moodle session | 302 to `moodlemobile://` with `token=` after `service` + `passport` |
| HTML pages | Cookies | Still how Grades user report, many activity pages, SIS, and Cengage work |

---

## 9. MCP tool impact (detailed)

Simplification is relative to today’s Playwright DOM scrape. “Browser for login” is assumed in every eClass row unless a future ADR stores a long-lived mobile token from the launch handshake.

### 9.1 Can drop HTML scraping for the main job

#### `list_courses`

- **Today:** `GET /my/courses.php`, wait for course cards or settled empty state, parse Moove markup.
- **After:** `core_course_get_enrolled_courses_by_timeline_classification`.
- **Confidence:** **High.** 29 courses returned with `id`, `fullname`, `shortname`.
- **Still need:** login cookies (or later a mobile token, which can call a similar function on REST).
- **Residual work:** map fields onto the existing `Course` type (`url` can be synthesized as `/course/view.php?id=`). Hidden/past courses: the timeline call has `classification` (`all`, `inprogress`, `future`, `past`) — choose the same policy the UI uses.

#### `get_course_content`

- **Today:** open the course page, parse sections and activity links, classify LTI/external platforms.
- **After:** `core_courseformat_get_state`; parse stringified JSON; walk `section[]` and `cm[]`.
- **Confidence:** **High for structure.** Sample course returned labels, forum, urls, visibility, plugin names (`mod_forum`, `mod_label`, …).
- **Gaps:** extra sections may load lazily; LTI / Cengage discovery currently uses DOM heuristics (`external_platforms`). Module `url` and `plugin` should still feed the existing classifier, but this must be verified on a Cengage-linked course.
- **Do not** call `core_course_get_contents` on the AJAX gateway.

#### `get_deadlines` / `get_upcoming_deadlines`

- **Today:** scrape assignment lists and/or calendar HTML; `parseEClassDate`.
- **After:** `core_calendar_get_calendar_upcoming_view` and/or `core_calendar_get_action_events_by_timesort` (and likely monthly view for the “month” scope).
- **Confidence:** **High that the functions are allowed.** Event **payload** must still be mapped (Unix `timesort`, `modulename`, course object). Zero events in August 2026 does not invalidate the path.
- **Gaps:** quiz vs assign vs manual events; course filter vs site calendar (`courseid: 1` is site home). Re-probe on a term with live deadlines before deleting the HTML scraper.

### 9.2 Somewhat simpler; hybrid or second phase

#### `get_section_text`

- State gives titles, visibility, and module lists. The current tool also extracts **main text, tabs, and links** from rendered HTML.
- **Likely hybrid:** JSON for the skeleton; one HTML fetch only if the consumer needs the prose of a label/page. Or accept structured intro HTML from other functions once REST is in play.
- **Confidence:** medium.

#### `get_file_text`

- Already downloads via session cookies and parses PDF/DOCX locally. URL allowlist already includes `/pluginfile.php` and `/webservice/pluginfile.php`.
- **Simplification:** skip wrapper-page scraping when the JSON outline already has a pluginfile URL. WAF challenges may still need a browser or a retry policy.
- **Confidence:** medium-high for “less DOM,” not “no HTTP session.”

#### `get_assignments` (eClass half)

- Due dates can ride the calendar JSON.
- `mod_assign_get_assignments` is **not** AJAX. Full assignment objects need mobile REST after `launch.php`, or keep HTML.
- Cross-platform resolver (Cengage/WebAssign) is **unchanged**.
- **Confidence:** medium. Phase 1: calendar-backed eClass rows. Phase 2: REST assigns.

#### `get_grades`

- AJAX: `gradereport_user_get_grade_items` = `servicenotavailable`.
- Page: server-rendered User report.
- **Phase 1:** keep Playwright (or a single `page.content()` parse without selector heroics).
- **Phase 2:** mobile REST `gradereport_user_get_grade_items` / overview after launch handshake.
- **Confidence:** high that AJAX will not save us; high that REST is the intended Moodle way.

#### `get_announcements`

- Same split as grades: `mod_forum_*` not on AJAX; Announcements is `mod_forum`.
- Course state already yields the forum module id and URL.
- **Phase 1:** keep HTML scrape of that forum (slightly easier with a stable module id).
- **Phase 2:** REST `mod_forum_get_forums_by_courses` + discussion/post functions.
- **Confidence:** same as grades.

### 9.3 Still need a browser (little change)

#### `get_item_details`

Assignment and quiz detail pages are heavy (dates, attempts, intro, files). No AJAX function was observed on those pages in this investigation. Keep Playwright or wait for REST `mod_assign_get_submission_status` / quiz functions after handshake.

#### `prepare_assignment_submission`

Read-only preflight of upload slots and constraints. Forms and file pickers are HTML. Keep Playwright until a REST preflight is designed. Signed `preflightRef` (T37/E20) stays.

#### `get_exam_schedule` / `get_class_timetable`

York SIS (`w2prod.sis.yorku.ca`), not Moodle. Out of scope for an eClass API.

#### Cengage / WebAssign tools

Different vendor. eClass only discovers the door (LTI/url). Keep current Cengage client. JSON course content may make **discovery** more reliable if `cm` plugins include LTI.

#### Login / session refresh

Passport York SAML still needs a real browser window. ADR 0001 and ADR 0002 remain. Even a future “mostly JSON” eClass client starts with that window unless York someday offers a student copy-paste token (they do not today).

#### RMP and cache tools

Not eClass Playwright. No change from this investigation.

---

## 10. Proposed architecture (plain language and technical)

### 10.1 Plain language

**Before:** The app pretends to be you in a web browser, waits for the page to draw, and copies text out of the layout.

**After:** You still log in once in a real browser, because York only lets people in through Passport York. After that, for courses, course outline, and deadlines, we ask eClass for lists instead of reading the page. Grades, announcements, and assignment internals are not on that “website list” door; they need either the old page reader or the same handshake the official phone app uses after you are already signed in. SIS and Cengage stay as they are.

York does not give students a Canvas-style “make a token in Settings” button. The phone-app handshake is the official substitute.

### 10.2 Technical target (see ADR 0010)

1. **Keep** visible Playwright (or equivalent) SSO and encrypted cookie storage.
2. **Add** an eClass JSON client:
   - Session mode: `POST /lib/ajax/service.php?sesskey=` with cookies, for AJAX-allowed functions.
   - Optional REST mode: after SSO, `GET /admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<random>`, intercept `Location`, persist the mobile credential in the encrypted session envelope, then `POST /webservice/rest/server.php`.
3. **Route tools** explicitly: AJAX vs REST vs HTML vs other host.
4. **Do not** send Passport York passwords to `/login/token.php` as the product design.
5. **Do not** log `sesskey`, `Location`, wstoken, RSS keys, or cookies.
6. **Leave** SIS and Cengage on their current clients.

### 10.3 Suggested implementation order (not started)

1. JSON client + `list_courses` dual-run (JSON vs scrape) behind a flag.
2. `get_course_content` from `core_courseformat_get_state`; keep scrape fallback.
3. Deadline tools from calendar functions; compare with scrape on a live term.
4. Only then: launch handshake + REST for grades / forums / assigns, or accept HTML for those indefinitely.
5. Delete scrape paths when dual-run is clean.

---

## 11. Architecture Decision Records produced by this work

The durable decision is filed as [ADR 0010](../adr/0010-hybrid-eclass-data-access.md). Summary:

- **Context:** Playwright DOM scraping is the main eClass cost; UTSC-style Canvas tokens do not exist here; Moodle web services and mobile login **are** on.
- **Decision:** Hybrid access. Session AJAX first. Optional official mobile launch handshake for REST. No password-to-`token.php` product path. No change to SIS/Cengage.
- **Status:** Proposed (investigation complete; code not landed).
- **Consequences:** Smaller Chromium footprint for some tools; still a browser for SSO; two Moodle gateways to test; stricter secret handling for launch `Location`.

Existing ADRs that remain in force:

- [0001 Local-first MCP](../adr/0001-local-first-mcp.md) — still local-only; JSON calls are still user-machine → York.
- [0002 Encrypted session storage](../adr/0002-secure-session-storage.md) — extend the envelope if a mobile token is stored; never plaintext.
- [0003 File cache](../adr/0003-file-cache.md) — JSON tools should keep `_cache` metadata.
- [0004 Selector registry](../adr/0004-selector-registry.md) — still required for remaining HTML tools; shrinks as tools move off DOM.
- [0005 Tool boundary](../adr/0005-tool-boundary-structured-errors.md) — map gateway errors (`servicenotavailable`, `invalidtoken`, `SESSION_EXPIRED`) into existing `code` values.

---

## 12. Failed probes, traps, and operational notes

These wasted hours once; they will waste hours again if omitted.

1. **Clicking Moodle “Continue” on an error page** drops query parameters. Always paste the full `launch.php?...` URL.
2. **Clicking the URL as a markdown link** may open `launch.php` with no query string → “service was missing.”
3. **`M.cfg.userid` vs `M.cfg.userId`:** lowercase is undefined on the dashboard; camelCase is the real id.
4. **`core_course_get_contents` on AJAX** always `servicenotavailable` here. Use `core_courseformat_get_state` in the browser, REST later if needed.
5. **Calendar matrix `summary: Array(7)`** was **object keys**, not seven events. Count `data.events`.
6. **Zero calendar events** can be “term is over,” not “API broken.”
7. **`core_courseformat_get_state` `data` is a string.** Parse before use.
8. **Custom scheme 302:** Chrome/Edge leave the previous document visible. Use Network → Preserve log. Look at `Location` in Headers, not the painted page.
9. **Preserve log off:** the 302 vanishes; it looks like nothing happened.
10. **Logged-out launch.php** goes to Shibboleth. Fine. Do not complete SSO *on* the launch URL if it will strip `service`/`passport`.
11. **Two Shibboleth tabs** destroy each other (`execution=e2s1`). Blank IdP page → close all York/Shib tabs, start at `https://eclass.yorku.ca` only.
12. **Do not GET** `.../SSO?execution=...&_eventId_proceed=1`. That is a POST-step bookmark.
13. **`local_savy_launchsavy`** is York-specific chrome. Ignore unless product scope includes Savy.
14. **Messaging `core_message_*` calls** fire on every page. They are not course data.
15. **Fake `token.php` passwords** returning `invalidlogin` is not a green light to automate Passport passwords.
16. **RSS key on Security keys is not a REST token.** Do not put it in `.env` as if it were a Quercus access token.

---

## 13. What remains unproven (honest gaps)

1. **Mobile REST function list for this student token.** We did not call `/webservice/rest/server.php` with a real wstoken (by design: that credential must not be copied into the repo or chat). Moodle’s catalog says the functions we care about are in `moodle_mobile_app`. York could still hide some. First implementation step after handshake: `core_webservice_get_site_info` and record the `functions[].name` list **locally**, never in git if it includes secrets (it should not, but treat the response as account-specific).
2. **Whether `managetoken.php` shows a mobile row after launch.** Reload after handshake during implementation; still never commit the value.
3. **Lazy extra sections** on large courses (`numsections` vs `sectionlist`).
4. **Cengage/LTI modules** in `cm[]` vs current DOM classifier.
5. **Live-term calendar payloads** (types, due vs cutoff, quizzes).
6. **File download via `/webservice/pluginfile.php` plus mobile token** vs cookie `pluginfile.php`.
7. **Write tools** (`submit_assignment`, calendar create). Out of scope; REST write functions exist in Moodle but this engine is read-only-first.
8. **Whether `token.php` accepts real Passport York passwords.** Not tested with real credentials; not the recommended path.
9. **QR login as an alternative mint** (profile button). Not scanned in this investigation; public config says it is on.
10. **Rate limits / WAF** on high-frequency `service.php` vs page loads.

---

## 14. Reproduction snippets (no secrets)

Run only in a logged-in eClass tab. Do not paste `sesskey`, cookies, tokens, or full `Location` headers into tickets.

### 14.1 Public config (works logged out)

POST `/lib/ajax/service.php` body:

```json
[{"index":0,"methodname":"tool_mobile_get_public_config","args":{}}]
```

### 14.2 Safe `M.cfg` dump

```javascript
({
  wwwroot: M.cfg.wwwroot,
  courseId: M.cfg.courseId,
  theme: M.cfg.theme,
  hasUserId: typeof M.cfg.userId !== "undefined",
  sesskeyChars: M.cfg.sesskey ? String(M.cfg.sesskey).length : 0
})
```

### 14.3 Enrolled courses

Use `methodname` `core_course_get_enrolled_courses_by_timeline_classification` and args `{ classification: "all", limit: 0, offset: 0, sort: "fullname" }`. Log `id` / `fullname` / `shortname` counts only if needed.

### 14.4 AJAX matrix

Probe calendar upcoming, calendar action events, `core_courseformat_get_state`, `gradereport_user_get_grade_items`, `mod_forum_get_forums_by_courses`, `mod_assign_get_assignments`, `core_enrol_get_users_courses`. Record `ok` and `errorcode` only.

### 14.5 Launch handshake

While already on My courses, new tab, Network Preserve log:

```text
https://eclass.yorku.ca/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=1
```

Record status and whether `Location` starts with `moodlemobile://`. If `token=` is present, do not save the value.

---

## 15. Security cautions (standing rules)

These are operational rules for anyone repeating the work or implementing ADR 0010. They are not an incident report.

1. **A Moodle mobile token is as powerful as being logged in to eClass as that user** for every function the mobile service allows (courses, files, grades, messages, depending on York’s function list). Treat it like a password.
2. **Never commit tokens, RSS keys, `sesskey`, cookies, or `launch.php` `Location` headers** to git, chat, screenshots in shared channels, issue trackers, or CI logs.
3. **Never put those values in `.env.example` or README.** If an implementation needs a stored mobile token, it belongs in the encrypted session envelope ([ADR 0002](../adr/0002-secure-session-storage.md)), with the same `ECLASS_MCP_SESSION_SECRET` rules as cookies.
4. **Do not print `Location` in debug logs.** Redact to scheme + “token present/absent.”
5. **Do not send Passport York passwords to `/login/token.php` from the product.** Campus login is SAML. Password-over-query-string also lands in proxy logs.
6. **RSS keys are not REST API keys.** Do not reuse them as `wstoken`.
7. **If a token or RSS key is ever exposed** (screenshot, gist, log dump), use Security keys → Reset where the UI allows it, sign out of the Moodle app, and mint again only into encrypted storage. Rotate `ECLASS_MCP_SESSION_SECRET` if session files may have been copied.
8. **Do not share QR login codes.** They expire quickly (~10 minutes) but they are login credentials for that window.
9. **Stay inside the existing URL allowlist.** New clients must use `eclass.yorku.ca` HTTPS paths already reasoned about in `url-policy.ts` (`/lib/ajax/service.php`, `/webservice/rest/server.php`, `/webservice/pluginfile.php`, `/admin/tool/mobile/launch.php`).
10. **This remains a student-owned, local-first tool** ([ADR 0001](../adr/0001-local-first-mcp.md)). Official APIs do not change the rule: only the account owner’s session, only their machine, no project cloud relay of credentials.
11. **Do not automate other people’s logins or scrape third-party accounts.**
12. **Playwright SSO windows can still show the launch redirect.** Disable following `moodlemobile://` as a document load; intercept at the response-header layer.

---

## 16. Comparison table (Canvas vs Moodle vs this repo)

| | UTSC Quercus | York eClass | This MCP today | This MCP after ADR 0010 |
| --- | --- | --- | --- | --- |
| LMS | Canvas | Moodle 5.1 | Playwright HTML | Hybrid JSON + leftover HTML |
| Student token UX | Settings → New Access Token | No copy-paste mobile token on Security keys (RSS only); QR + `launch.php` | Encrypted cookies | Cookies + optional launch token in the same encrypted store |
| HTTP style | `/api/v1/...` + Bearer | `/webservice/rest/server.php?wsfunction=` or AJAX `methodname` | `page.goto` | `fetch` to AJAX/REST |
| Login | UTORid / Shibboleth | Passport York SAML (`typeoflogin=3`) | Visible Chromium | Still visible Chromium for SSO |
| Mobile app | Canvas Student | Official Moodle app, enabled | Unused | Handshake reuse |
| Grades API for website session | Canvas REST | Not on AJAX; HTML or mobile REST | HTML | HTML or REST |
| Deploy story | Token in env, no browser | Browser at least once | Always Chromium | Chromium for login; much less Chromium for reads |

---

## 17. Timeline of the investigation (13 Aug 2026)

Approximate order, for anyone reconstructing the conversation:

1. Hypothesis: friend used APIs + account token on UTSC; can eClass?
2. Identified Quercus = Canvas vs eClass = Moodle.
3. Unauthenticated probes: Shibboleth on `/`, `token.php` missingparam/invalidlogin, REST `invalidtoken`, public config with web services and mobile **on**, `typeoflogin=3`, QR login on.
4. Logged-in Network: `service.php` + `core_course_get_enrolled_courses_by_timeline_classification`.
5. Console: 29 courses JSON.
6. Security keys = RSS only; Preferences has Security keys; profile has Mobile QR.
7. `core_courseformat_get_state` works; `core_course_get_contents` AJAX `servicenotavailable`; `M.cfg.userId` camelCase; Moodle 5.1 docs.
8. Bare `launch.php` missing `service`; with service missing `passport`.
9. AJAX matrix: calendar + courseformat yes; grades/forum/assign/enrol_get_users_courses no.
10. Calendar counts: 0 events (empty success).
11. Launch URL while logged out → Shibboleth; mid-flow blank IdP from multi-tab.
12. Launch URL while logged in, Preserve log: **302 `moodlemobile://` with `token=`**.
13. Architecture chosen: hybrid. This document and ADR 0010 written.

---

## 18. References

### 18.1 York

- <https://www.yorku.ca/uit/student-services/learning-technologies/>
- <https://lthelp.yorku.ca/mobile-app>
- Site: <https://eclass.yorku.ca>

### 18.2 Moodle

- <https://docs.moodle.org/dev/Creating_a_web_service_client>
- <https://docs.moodle.org/dev/Web_service_API_functions>
- <https://docs.moodle.org/500/en/Moodle_app_guide_for_admins>
- Public function `tool_mobile_get_public_config` (login not required, AJAX)

### 18.3 Canvas (contrast only)

- Instructure: managing API access tokens in a user account
- Public UTSC/UofT tools that document Quercus `Approved Integrations` tokens (Canvas REST)

### 18.4 This repository

- [`docs/PROJECT_MASTER.md`](../PROJECT_MASTER.md)
- [`docs/operational-limits.md`](../operational-limits.md)
- [`docs/tools/README.md`](../tools/README.md)
- [`src/security/url-policy.ts`](../../src/security/url-policy.ts)
- [`src/scraper/eclass/`](../../src/scraper/eclass/)
- [ADR 0001](../adr/0001-local-first-mcp.md)–[0009](../adr/0009-cache-observability.md), [ADR 0010](../adr/0010-hybrid-eclass-data-access.md)

---

## 19. Document control

| | |
| --- | --- |
| Created | 13 August 2026 |
| Authors | Investigation recorded from live public probes and owner-operated DevTools |
| Classification | Internal engineering notes; no credentials |
| Implementation | Not started; follow ADR 0010 |

If Moodle or York change `enablemobilewebservice`, `typeoflogin`, student capabilities on `managetoken.php`, or AJAX-allowed functions, **re-run §14** before deleting scrape code. Public config is cheap and does not require a token.
