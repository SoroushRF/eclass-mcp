# ADR 0006: Runtime Resilience And RMP Circuit Breaker

## Status

Accepted.

## Context

The local MCP runtime owns browser and HTTP resources that may outlive a single tool call if the host disconnects or the process receives a signal. RateMyProfessors is also an external HTTP dependency that can return repeated 429, timeout, or upstream failures.

## Decision

Add explicit best-effort shutdown cleanup for stdio, the local auth server, visible auth browsers, the eClass singleton, tracked Cengage scrapers, and tracked SIS browsers. Add a narrow in-memory circuit breaker only around the RMP GraphQL HTTP boundary, opening after repeated classified upstream failures and returning structured `RATE_LIMITED` responses during cooldown.

## Consequences

- Shutdown is more predictable, but signal cleanup is still bounded and best-effort.
- RMP failures stop hammering the external service after repeated failures.
- The breaker is process-local and resets on restart.
- eClass, SIS, Cengage, and WebAssign browser flows are intentionally not circuit-broken yet because they have auth, page-state, and navigation semantics that need separate design.
