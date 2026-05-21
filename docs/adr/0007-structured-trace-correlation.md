# ADR 0007: Structured Trace Correlation

## Status

Accepted.

## Context

The project already logs JSON to stderr with Pino and redaction helpers. Full OpenTelemetry would add dependency and exporter policy before there is a clear collector target, but senior operational review still benefits from correlating logs across a single MCP tool call.

## Decision

Use `AsyncLocalStorage` to attach `requestId`, `traceId`, `spanId`, `parentSpanId`, `tool`, `span`, and optional `component` fields to Pino loggers. Tool invocations create root trace context; selected high-value operations use child spans or structured events. Logs remain stderr-only and continue to redact sensitive URLs, cookies, tokens, and session material.

## Consequences

- Operators can follow a tool call across tool wrappers, boundary mapping, RMP GraphQL, cache, and runtime events without a tracing backend.
- This is structured trace correlation, not an OpenTelemetry exporter.
- Future OpenTelemetry support can map these fields to spans if a collector/export policy is chosen.
