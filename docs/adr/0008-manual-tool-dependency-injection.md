# ADR 0008: Manual Tool Dependency Injection

## Status

Accepted.

## Context

Direct singleton imports made low-level tool tests depend on module mocking and global scraper state. A full dependency-injection framework would be disproportionate for a local MCP server and would make the runtime harder to inspect.

## Decision

Use explicit TypeScript dependency objects at the tool registration boundary. Production `createMcpServer()` builds default dependencies, while tests may pass fake eClass, SIS, RMP, Cengage, and other tool-level factories. Keep runtime infrastructure such as auth server startup, logging, and shutdown outside the tool dependency object unless a narrow test seam is needed.

## Consequences

- Tool tests can prove behavior with fake scrapers/clients without mutating production singletons.
- Production behavior remains the existing local singleton/factory lifecycle by default.
- Complex side-effect-heavy flows can be migrated incrementally as their contracts are understood.
