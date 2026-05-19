# Logging (E14)

The MCP server uses **[Pino](https://github.com/pinojs/pino)** for structured JSON logs on **stderr** only. **Stdout** is reserved for the MCP JSON-RPC stream when using stdio transport; do not log to stdout from server code.

## Environment

| Variable               | Values                                                       | Default |
| ---------------------- | ------------------------------------------------------------ | ------- |
| `ECLASS_MCP_LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `info`  |

Vitest sets `ECLASS_MCP_LOG_LEVEL=silent` in [`vitest.config.ts`](../vitest.config.ts) to keep test output quiet.

## Correlation And Traces

Each MCP tool invocation runs inside **AsyncLocalStorage** with:

- **`requestId`** - UUID for one tool call
- **`traceId`** - stable ID for the full tool call trace; currently starts as the same value as `requestId`
- **`spanId`** - UUID for the current operation span
- **`parentSpanId`** - parent operation span when inside nested work
- **`tool`** - registered tool name (e.g. `get_deadlines`)
- **`span`** - current span name (e.g. `mcp.tool`, `rmp.graphql`, `tool.boundary`)
- **`component`** - small subsystem label such as `mcp`, `rmp`, `shutdown`, or `tool-boundary`

Use **`getLogger()`** from [`src/logging/context.ts`](../src/logging/context.ts) anywhere in the async call chain; outside a tool context it falls back to the root logger.

Use **`runWithSpan()`** for high-value nested operations. It logs `span_start`, `span_end`, and `span_error` with `durationMs`, while preserving the parent `requestId` and `traceId`.

This is structured trace correlation, not an OpenTelemetry exporter. There is no collector, sampling policy, or external telemetry dependency yet.

Example field set:

```json
{
  "event": "span_end",
  "tool": "search_professors",
  "requestId": "7b6f...",
  "traceId": "7b6f...",
  "spanId": "91a2...",
  "parentSpanId": "2c8d...",
  "span": "rmp.graphql",
  "component": "rmp",
  "durationMs": 42,
  "operationName": "NewSearchTeachersQuery",
  "httpStatus": 200
}
```

## Redaction

- Pino **`redact`** applies to common structured keys (`cookie`, `cookies`, `setCookie`, `headers.cookie`).
- Free-form strings can be passed through **`redactCookieSubstrings`** / **`safeString`** in [`src/logging/redact.ts`](../src/logging/redact.ts) before logging.

## Modules

| File                                                  | Role                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| [`src/logging/logger.ts`](../src/logging/logger.ts)   | Root logger to stderr                                              |
| [`src/logging/context.ts`](../src/logging/context.ts) | `runWithToolContext`, `runWithSpan`, `getLogger`, trace context    |
| [`src/logging/redact.ts`](../src/logging/redact.ts)   | String scrubbing for cookies / session params                      |

Tool registration in [`src/index.ts`](../src/index.ts) wraps each handler with **`runWithToolContext`** so every tool gets `requestId`, `traceId`, `spanId`, and `tool` on related log lines.
