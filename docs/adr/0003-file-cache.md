# ADR 0003: Versioned File-Based Cache

## Status

Accepted.

## Context

The server repeatedly scrapes pages and parses files that are expensive, rate-limited, or slow. A cache improves latency and reduces upstream load, but the project is intentionally local-first and should not require Redis, SQLite, or a hosted service for normal student use.

## Decision

Use versioned JSON files under `.eclass-mcp/cache/` with tiered TTLs, pinned-cache exceptions, and explicit cache freshness metadata in cache-backed JSON tool responses. Generate logical keys through `getCacheKey()` so schema-version changes can invalidate old entries without ad hoc filename suffixes.

## Consequences

- The cache is easy to inspect, delete, and back up locally.
- Cache files may contain plaintext academic data, so docs must present them as local sensitive artifacts.
- `clear_cache` must clear both current versioned prefixes and legacy prefixes while preserving user-pinned entries.
