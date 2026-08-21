# Architecture Decision Records

This directory records durable engineering decisions for the local-first eClass MCP server. ADRs are intentionally short: they explain the context, the decision, and the tradeoffs that future maintainers should preserve or revisit.

## Index

- [0001: Local-First MCP Boundary](./0001-local-first-mcp.md)
- [0002: Encrypted Local Session Storage](./0002-secure-session-storage.md)
- [0003: Versioned File Cache](./0003-file-cache.md)
- [0004: Selector Registry](./0004-selector-registry.md)
- [0005: MCP Tool Boundary And Structured Errors](./0005-tool-boundary-structured-errors.md)
- [0006: Runtime Resilience And RMP Circuit Breaker](./0006-runtime-resilience-rmp-circuit-breaker.md)
- [0007: Structured Trace Correlation](./0007-structured-trace-correlation.md)
- [0008: Manual Tool Dependency Injection](./0008-manual-tool-dependency-injection.md)
- [0009: Read-Only Cache Observability](./0009-cache-observability.md)
- [0010: Hybrid eClass Data Access (session JSON + optional mobile handshake)](./0010-hybrid-eclass-data-access.md) — Proposed; investigation in [`docs/investigations/eclass-official-api-feasibility.md`](../investigations/eclass-official-api-feasibility.md)
