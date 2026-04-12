# E12: Structured errors and machine codes

**Status:** complete (Phases 0–4).  
**Related:** [E11 tool output inventory](./e11-tool-output-inventory.md), [`src/tools/eclass-contracts.ts`](../src/tools/eclass-contracts.ts), [`src/errors/codes.ts`](../src/errors/codes.ts).

This document is the **canonical reference** for how the eClass MCP server exposes machine-readable failure information in tool results. It complements the high-level tracker entry in [`PROJECT_MASTER.md`](./PROJECT_MASTER.md) (E12).

---

## 1. Goals

- Add a stable **`code`** field (and optional **`details`**) to JSON tool payloads so hosts, clients, and models can branch on failure _kind_ without parsing English prose.
- Keep changes **additive**: existing keys (`message`, `status`, `ok`, `retry`, etc.) stay; `code` is optional on many schemas via Zod passthrough.
- Align runtime validation with **E11**: `asValidatedMcpText` / `asValidatedMcpResult` + Zod `safeParse` by default; `ECLASS_MCP_STRICT_TOOL_OUTPUT=1` for strict `.parse()` when debugging.

---

## 2. Machine codes (`MachineCode`)

Defined in [`src/errors/codes.ts`](../src/errors/codes.ts) as `MACHINE_CODES` / `MachineCode`:

| Code                    | Meaning                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_EXPIRED`       | Session cookie or auth context is no longer valid; user may need to complete login (often with `status: 'auth_required'` and `retry`). |
| `SCRAPE_LAYOUT_CHANGED` | HTML/DOM no longer matches scraper expectations (Moodle layout drift).                                                                 |
| `UPSTREAM_ERROR`        | Generic network or upstream failure (non-429, non-timeout classification).                                                             |
| `RATE_LIMITED`          | HTTP 429 or explicit rate-limit signals.                                                                                               |
| `TIMEOUT`               | Timeouts, `TimeoutError`, `AbortError`, HTTP 408/504 where mapped.                                                                     |
| `VALIDATION_FAILED`     | Tool arguments failed **business** validation (missing required fields, bad date range, etc.).                                         |
| `INTERNAL_ERROR`        | Reserved for uncategorized server-side failures (prefer mapping to a more specific code when possible).                                |

Zod: `MachineCodeSchema` / optional variants live in [`src/tools/eclass-contracts.ts`](../src/tools/eclass-contracts.ts).

---

## 3. JSON shapes and helpers

### 3.1 `toErrorPayload` / `sessionExpiredPayload`

[`src/errors/tool-error.ts`](../src/errors/tool-error.ts):

- **`sessionExpiredPayload(message, retry)`** — builds `{ status: 'auth_required', code: 'SESSION_EXPIRED', message, retry }` for eClass-style tools.
- **`toErrorPayload(code, message, options?)`** — builds `{ status: 'error' | 'auth_required', code, message, ... }` with optional **`details`** (record) and **`retry`**.

Validated against **`EclassToolErrorResponseSchema`** (errors) or **`EclassAuthRequiredSchema`** (auth) as appropriate.

### 3.2 Tool output validation

[`src/tools/mcp-validated-response.ts`](../src/tools/mcp-validated-response.ts) wraps payloads in MCP `content: [{ type: 'text', text: JSON.stringify(...) }]`. On schema failure, the helper logs a warning and still returns JSON (unless strict mode).

---

## 4. Error classes and mapping (by phase)

### Phase 1 — Session (`SESSION_EXPIRED`)

- **`SessionExpiredError`** ([`src/scraper/session.ts`](../src/scraper/session.ts)) carries `code: 'SESSION_EXPIRED'`.
- eClass, SIS, pins, Cengage auth paths return **`sessionExpiredPayload()`** in tool handlers when this error is caught.

### Phase 2 — Scraper drift (`SCRAPE_LAYOUT_CHANGED`)

- **`ScrapeLayoutError`** ([`src/scraper/scrape-errors.ts`](../src/scraper/scrape-errors.ts)) with optional **`context`** for debugging.
- Example: file download HTML wrapper with no extractable direct URL ([`src/scraper/eclass/files.ts`](../src/scraper/eclass/files.ts)); tool layer [`src/tools/files.ts`](../src/tools/files.ts) maps to **`toErrorPayload('SCRAPE_LAYOUT_CHANGED', …)`**.

### Phase 3 — Network (`UPSTREAM_ERROR`, `RATE_LIMITED`, `TIMEOUT`)

- **`UpstreamError`** + **`upstreamErrorFromHttpStatus`** + **`upstreamErrorFromUnknown`** in [`src/scraper/scrape-errors.ts`](../src/scraper/scrape-errors.ts).
- **RMP** ([`src/scraper/rmp.ts`](../src/scraper/rmp.ts)): `fetch` failures, non-OK HTTP, invalid JSON, GraphQL `errors` in the response body.
- **File download** ([`src/scraper/eclass/files.ts`](../src/scraper/eclass/files.ts)): Playwright `request.get` non-OK responses; other Playwright/network errors mapped via **`upstreamErrorFromUnknown`**.
- **Tools:** [`src/tools/rmp.ts`](../src/tools/rmp.ts), [`src/tools/files.ts`](../src/tools/files.ts) return **`EclassToolErrorResponseSchema`** with **`toErrorPayload(error.code, …)`** and optional **`details.httpStatus`**.

### Phase 4 — Validation (`VALIDATION_FAILED`)

- **`ValidationError`** ([`src/errors/validation-error.ts`](../src/errors/validation-error.ts)) with optional **`details`** (e.g. `{ field: 'url' }`, `{ scope: 'range', missing: ['from'] }`).
- **Deadlines** ([`src/tools/deadlines.ts`](../src/tools/deadlines.ts)):
  - `get_deadlines` with `scope: 'range'` but missing **`from`** / **`to`**, or invalid boundary dates.
  - `get_item_details` when **`url`** is missing or empty.
- **RMP** ([`src/tools/rmp.ts`](../src/tools/rmp.ts)): missing **`name`** (search) or **`teacherId`** (details) — returned as JSON with **`VALIDATION_FAILED`** instead of MCP **`InvalidParams`** (see §5).

---

## 5. Policy: `McpError` vs JSON tool body

| Mechanism                                                       | When to use                                                                                                                                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`McpError` with `ErrorCode.InvalidParams`**                   | Prefer **only** for arguments that violate the MCP/SDK contract in a way the **host** should fix before retry (rare here because many tools take `any` and validate in code).    |
| **JSON with `status: 'error'` and `code: 'VALIDATION_FAILED'`** | **User-visible** and **model-visible** validation: missing required fields, bad date ranges, empty URLs. The assistant sees the same structured JSON as for other tool failures. |
| **`McpError` with `ErrorCode.InternalError`**                   | Unexpected failures after validation (e.g. RMP search threw a non-`UpstreamError`).                                                                                              |

RMP required-field checks were moved to **`VALIDATION_FAILED`** JSON for consistency with E12 and with deadlines/file validation UX.

---

## 6. Primary source files (quick index)

| Area                   | Files                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| Codes                  | `src/errors/codes.ts`                                              |
| Payload helpers        | `src/errors/tool-error.ts`                                         |
| Validation errors      | `src/errors/validation-error.ts`                                   |
| Scraper errors         | `src/scraper/scrape-errors.ts`                                     |
| Session                | `src/scraper/session.ts`                                           |
| RMP client             | `src/scraper/rmp.ts`                                               |
| eClass barrel exports  | `src/scraper/eclass.ts`                                            |
| Zod contracts          | `src/tools/eclass-contracts.ts`                                    |
| Validation wrapper     | `src/tools/mcp-validated-response.ts`                              |
| Tools (representative) | `src/tools/deadlines.ts`, `src/tools/files.ts`, `src/tools/rmp.ts` |

---

## 7. Tests

Contract and behavior coverage live primarily in [`tests/e12-phase0.test.ts`](../tests/e12-phase0.test.ts) (phases 0–4 scenarios: session, layout, upstream, validation). Run:

```bash
npm run test -- --run tests/e12-phase0.test.ts
```

---

## 8. Environment

- **`ECLASS_MCP_STRICT_TOOL_OUTPUT`**: set to `1` or `true` to fail fast on Zod validation errors in `asValidatedMcpText` / `asValidatedMcpResult` (see [`mcp-validated-response.ts`](../src/tools/mcp-validated-response.ts)).

---

_End of E12 structured errors reference._
