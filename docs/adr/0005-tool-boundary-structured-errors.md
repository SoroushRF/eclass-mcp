# ADR 0005: MCP Tool Boundary And Structured Errors

## Status

Accepted.

## Context

MCP clients need stable JSON responses for expected tool failures such as expired sessions, validation errors, scrape-layout drift, upstream failures, timeouts, and rate limits. Duplicating that mapping in every tool made behavior harder to audit and increased the chance that one tool would throw protocol errors where another returned E12-compatible JSON.

## Decision

Keep MCP registration responsible for protocol registration and trace context, and keep business-level error mapping in shared tool-boundary helpers. eClass and SIS tools use the common boundary for auth retry and E12 machine-code mapping. Other tool families may use specialized boundary options when their response envelopes differ, but expected operational failures should remain structured JSON instead of raw exceptions.

Current boundary ownership:

| Tool family | Boundary policy |
| --- | --- |
| eClass and SIS | `runEclassToolBoundary` handles secure-session failures, eClass auth retry, validation, layout drift, and upstream errors. |
| RateMyProfessors | `runToolBoundary` preserves RMP response envelopes while mapping upstream, timeout, rate-limit, validation, and circuit-open failures. |
| Cengage/WebAssign | Custom envelopes stay in the Cengage tools because auth, course activation, and `needs_course_activation` retry guidance are richer than the eClass envelope. |
| `get_assignments` | Custom resolver envelope stays in place because it merges eClass and Cengage results and writes platform-index side effects. |
| Cache and pins | Local-state envelopes stay tool-specific; only `cache_refresh_pin` performs eClass auth retry because it can re-fetch pinned eClass resources. |
| MCP registration | `registerTool` wrappers provide trace context and protocol result validation only; they do not own business-level error mapping. |

## Consequences

- Public tool response shapes remain tool-specific, but common machine codes stay consistent.
- Cengage and cross-platform assignment flows can preserve richer envelopes while still sharing boundary policy where safe.
- Unknown errors may still throw when a tool contract intentionally treats them as unexpected defects.
