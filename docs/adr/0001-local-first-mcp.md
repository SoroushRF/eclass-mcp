# ADR 0001: Local-First MCP Server

## Status

Accepted.

## Context

The project exposes a student-owned read-only workflow over York eClass, SIS, Cengage/WebAssign, course files, and RateMyProfessors. These services require user-specific sessions and can contain sensitive academic data.

## Decision

Run the MCP server locally and communicate with the host over stdio. Remote requests are made directly from the user's machine to the relevant upstream service only when the corresponding tool is used. The project does not introduce a project-owned backend or cloud relay.

Authenticated fetch and navigation URLs are constrained by a central HTTPS allowlist for the supported upstream services. User-supplied and page-derived URLs are normalized, stripped of fragments, checked for exact allowed hosts and paths, and rejected if they target localhost/private networks, unsafe protocols, embedded credentials, or host-spoofing suffixes.

## Consequences

- User session files, caches, pins, debug output, and mappings stay on the local filesystem.
- Local-first does not mean arbitrary local-network access: remote tool URLs are bounded to expected upstream hosts, and pinned refreshes re-validate stored URLs before re-fetching.
- Setup depends on the user's local Node.js, Playwright browser install, and Claude Desktop configuration.
- Reliability and observability are local-first; future production telemetry must preserve the no-project-cloud boundary unless a new ADR changes it.
