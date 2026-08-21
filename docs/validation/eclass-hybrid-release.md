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

This validates MCP framing, tool discovery, the built artifact, and
configuration rollback behavior. It is not a credentialed eClass read.

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
covered by deterministic unit tests. REST-backed MCP tools were not enabled,
so no live token invalidation rehearsal was appropriate.
