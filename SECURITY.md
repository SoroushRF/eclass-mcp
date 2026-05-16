# Security policy

## Supported versions

Security fixes are applied to the **latest commit on the default branch** (`master`). There is no separate long-term support (LTS) line yet; use the newest release or tip of default branch.

## Scope

**In scope**

- This repository’s **application code** (`src/`, build scripts, MCP tool handlers).
- **Dependency** issues that materially affect this project when used as documented (e.g. RCE, credential theft via the local server).
- **Mis-handling of sensitive local data**: e.g. unintended exposure of session cookies, tokens, or scraped academic data on disk (`session.json`, cache under `.eclass-mcp/`, logs).

**Out of scope (by default)**

- Vulnerabilities in **York University / eClass** infrastructure you do not control.
- Issues that require **physical access** to the user’s machine or a **fully compromised** OS user account (treat as local threat model).
- **Social engineering**, spam, or abuse of third-party services (eClass, Claude Desktop, etc.) outside this codebase.

**Sensitive data reminder**

This tool stores **encrypted Playwright session cookies / browser storage state** and **plaintext cached course data** under **`.eclass-mcp/`** on the user’s machine. Auth sessions require `ECLASS_MCP_SESSION_SECRET`; keep that `.env` value private because anyone with both the encrypted session files and the secret can use the saved session.

Session encryption protects against casual copying of `.eclass-mcp/session.json` or `.eclass-mcp/cengage-state.json`. It does **not** protect against a fully compromised OS user account, a malicious process running as the same user, keyloggers, or disclosure of the local `.env` file.

The local `/logout` route performs best-effort auth-session deletion and overwrite before unlinking. Secure wipe cannot be guaranteed on SSDs, journaling filesystems, OneDrive/cloud sync, backups, or other copy-on-write storage.

## Remote URL boundary

User-supplied or page-derived URLs that can trigger authenticated fetches or browser navigation are checked against a central allowlist before use. The server permits HTTPS-only requests to the expected upstream services for the relevant tool: York eClass, Cengage/WebAssign/GetEnrolled, and RateMyProfessors where applicable.

The URL boundary rejects unsupported protocols, embedded credentials, spoofed hosts such as `eclass.yorku.ca.evil.test`, localhost/private-network hosts, IP literals in private ranges, and off-policy paths. Pinned-cache refresh re-validates stored resource URLs before re-fetching, so older pins cannot bypass the current policy.

Validation errors redact sensitive query parameters such as `sesskey`, `wstoken`, `token`, `code`, `SAMLResponse`, and `RelayState` before logging or returning details.

## Future write-tool risk model

Future upload/submission/calendar tools may perform actions that are difficult or impossible to undo in normal eClass, Cengage/WebAssign, or Moodle use. Users remain responsible for confirming the target course, assignment, due date, submission state, and local files before a write.

The project reduces write risk with an accuracy-first contract: read-only preflight first, a signed `preflightRef`, explicit per-call `confirm: true`, target revalidation immediately before mutation, structured write failure codes, and later E21 append-only audit logging. Claude or host-level tool permissions are convenience controls, not the safety source of truth. This project is not affiliated with York University and provides no institutional warranty.

## Reporting a vulnerability

**Preferred (GitHub)**

If this project is hosted on GitHub, use **Security → Report a vulnerability** to send a **private** advisory. That keeps details off public issues until coordinated disclosure.

**If GitHub advisories are not available**

Contact the maintainer (**author** field in [`package.json`](package.json)) through a **private** channel you both agree on (e.g. encrypted email). Do **not** post exploit details in public issues before a fix or agreed disclosure timeline.

Please include:

- A short description and impact
- Steps to reproduce (or a proof-of-concept), if safe to share
- Affected version / commit if known

We aim to acknowledge reports within a **few business days** and to work toward a fix and disclosure timeline with you. This is a volunteer-maintained project; timelines depend on severity and availability.

## Safe harbor

We support **good-faith** security research that follows this policy:

- Do not access, modify, or exfiltrate **other users’** data without authorization.
- Do not degrade or disrupt services (including eClass or University systems) beyond what is **necessary** to demonstrate an issue.
- Give us a **reasonable** time to fix before public disclosure (typically **90 days**, shorter for critical issues by mutual agreement).

We will not pursue legal action against researchers for activities that comply with the above and with applicable law. This does not waive any rights beyond that narrow commitment.

## Disclosure

After a fix is available, we may credit you in release notes or advisories **if you want** to be named. Let us know your preference when you report.
