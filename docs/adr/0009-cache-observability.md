# ADR 0009: Read-Only Cache Observability

## Status

Accepted.

## Context

The local cache and pin registry are intentionally file-based and user-local. Maintainers still need a way to inspect aggregate health, quota pressure, stale pinned entries, schema mismatches, and process-local cache counters without exposing sensitive filenames or URLs.

## Decision

Add process-local cache metrics and a read-only `cache_health` MCP tool. The health scanner reports aggregate counts, warning codes, pin quota state, and metrics since process start. It does not delete expired files, refresh pins, authenticate, scrape upstream services, or reveal raw cache keys, raw filenames, sensitive URLs, cookies, or absolute paths.

## Consequences

- Operators get local observability without mutating cache state.
- Disk health and process-local counters can diverge until lazy expiry or explicit clears occur; that is expected and documented as local diagnostic context.
- Cache cleanup remains an explicit user action through existing cache tools.
