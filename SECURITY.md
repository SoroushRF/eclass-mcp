# Security policy

## Supported versions

Security fixes are applied to the **latest commit on the default branch** (`main` or `master`, whichever this repository uses). There is no separate long-term support (LTS) line yet; use the newest release or tip of default branch.

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

This tool stores **Playwright session cookies** and **cached course data** under **`.eclass-mcp/`** on the user’s machine. Reports that describe leaks or unsafe persistence of that data are welcome.

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
