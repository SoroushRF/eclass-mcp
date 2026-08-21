# eClass hybrid MCP host validation

**Branch:** `feat/eclass-hybrid-api`  
**Artifact:** current `dist/index.js` after `npm.cmd run build`  
**Source mode:** `ECLASS_API_SOURCE_MODE=playwright`

## Inspector CLI

With no saved eClass session and an empty session-secret environment variable,
the MCP Inspector CLI completed these safe protocol checks:

```powershell
npx.cmd @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx.cmd @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call --tool-name cache_health
```

`tools/list` returned exactly 26 tools, including the eClass tools
`list_courses`, `get_course_content`, `get_grades`, and
`get_upcoming_deadlines`. The safe `cache_health` call returned a valid
successful MCP text response. The host bound its local auth server to
`127.0.0.1`, and no AJAX, REST, or mobile-launch request was made during
startup or either check.

This validates the built artifact, MCP framing, tool schemas, one
representative non-eClass call, and the Playwright-only rollback setting. It
does not validate a credentialed eClass read.

## Scope limits

No Claude Desktop prompt-matrix run was recorded because the worktree has no
account session. The account-owner live comparison remains the required gate
for API-primary promotion and is tracked in
[`eclass-hybrid-canary.md`](./eclass-hybrid-canary.md).
