# Logging (E14)

The MCP server uses **[Pino](https://github.com/pinojs/pino)** for structured JSON logs on **stderr** only. **Stdout** is reserved for the MCP JSON-RPC stream when using stdio transport—do not log to stdout from server code.

## Environment

| Variable               | Values                                                       | Default |
| ---------------------- | ------------------------------------------------------------ | ------- |
| `ECLASS_MCP_LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `info`  |

Vitest sets `ECLASS_MCP_LOG_LEVEL=silent` in [`vitest.config.ts`](../vitest.config.ts) to keep test output quiet.

## Correlation

Each MCP tool invocation runs inside **AsyncLocalStorage** with:

- **`requestId`** — UUID for one tool call
- **`tool`** — registered tool name (e.g. `get_deadlines`)

Use **`getLogger()`** from [`src/logging/context.ts`](../src/logging/context.ts) anywhere in the async call chain; outside a tool context it falls back to the root logger.

## Redaction

- Pino **`redact`** applies to common structured keys (`cookie`, `cookies`, `setCookie`, `headers.cookie`).
- Free-form strings can be passed through **`redactCookieSubstrings`** / **`safeString`** in [`src/logging/redact.ts`](../src/logging/redact.ts) before logging.

## Modules

| File                                                  | Role                                          |
| ----------------------------------------------------- | --------------------------------------------- |
| [`src/logging/logger.ts`](../src/logging/logger.ts)   | Root logger → stderr                          |
| [`src/logging/context.ts`](../src/logging/context.ts) | `runWithToolContext`, `getLogger`             |
| [`src/logging/redact.ts`](../src/logging/redact.ts)   | String scrubbing for cookies / session params |

Tool registration in [`src/index.ts`](../src/index.ts) wraps each handler with **`runWithToolContext`** so every tool gets `requestId` + `tool` on related log lines.
