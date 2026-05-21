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

| Code                           | Meaning                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_EXPIRED`              | Session cookie or auth context is no longer valid; user may need to complete login (often with `status: 'auth_required'` and `retry`).                                                |
| `SESSION_STORAGE_UNAVAILABLE`  | Local encrypted session storage cannot be used because `ECLASS_MCP_SESSION_SECRET` is missing/too short, the secret is wrong, or a legacy plaintext/malformed session file was found. |
| `SCRAPE_LAYOUT_CHANGED`        | HTML/DOM no longer matches scraper expectations (Moodle layout drift).                                                                                                                |
| `UPSTREAM_ERROR`               | Generic network or upstream failure (non-429, non-timeout classification).                                                                                                            |
| `RATE_LIMITED`                 | HTTP 429, explicit rate-limit signals, or local protection such as the RMP circuit breaker.                                                                                            |
| `TIMEOUT`                      | Timeouts, `TimeoutError`, `AbortError`, HTTP 408/504 where mapped.                                                                                                                    |
| `VALIDATION_FAILED`            | Tool arguments failed **business** validation (missing required fields, bad date range, etc.).                                                                                        |
| `COURSE_CONTEXT_MISMATCH`      | Cengage/WebAssign opened a different active course than the selected course; tools return `needs_course_activation`, not auth retry.                                                  |
| `WRITE_CONFIRMATION_REQUIRED`  | A future write tool was called without explicit `confirm: true`.                                                                                                                      |
| `WRITE_PREFLIGHT_REQUIRED`     | A future write tool was called without a valid signed `preflightRef` from the prepare tool.                                                                                           |
| `WRITE_PREFLIGHT_EXPIRED`      | The signed preflight reference is too old; call the prepare tool again.                                                                                                               |
| `WRITE_TARGET_AMBIGUOUS`       | The write target cannot be resolved to one exact course/activity/file slot.                                                                                                           |
| `WRITE_PRECHECK_FAILED`        | The prepare or write precheck found a blocking issue before mutation.                                                                                                                 |
| `WRITE_PLATFORM_STATE_CHANGED` | The platform state no longer matches the signed preflight facts; call the prepare tool again.                                                                                         |
| `UPLOAD_SLOT_NOT_FOUND`        | The expected Moodle/Cengage upload control could not be found.                                                                                                                        |
| `SUBMISSION_ALREADY_FINALIZED` | The assignment appears already submitted/finalized and should not be changed by automation.                                                                                           |
| `INTERNAL_ERROR`               | Reserved for uncategorized server-side failures (prefer mapping to a more specific code when possible).                                                                               |

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

### 3.3 Boundary ownership

MCP registration owns trace context and protocol result validation only. Business error mapping stays at the tool layer:

| Tool family | Boundary policy |
| --- | --- |
| eClass and SIS | Shared `runEclassToolBoundary` for secure-session failures, eClass auth retry, validation, scrape-layout drift, and upstream errors. |
| RateMyProfessors | Shared `runToolBoundary` with RMP-specific response schemas for validation, upstream, timeout, rate-limit, and circuit-open failures. |
| Cengage/WebAssign | Custom Cengage envelopes for auth, course activation, and `needs_course_activation` guidance. |
| `get_assignments` | Custom cross-platform resolver envelope because it merges eClass and Cengage/WebAssign state. |
| Cache and pins | Local-state envelopes; `cache_refresh_pin` is the only pin tool that performs eClass auth retry. |

---

## 4. Error classes and mapping (by phase)

### Phase 1 — Session (`SESSION_EXPIRED`)

- **`SessionExpiredError`** ([`src/scraper/session.ts`](../src/scraper/session.ts)) carries `code: 'SESSION_EXPIRED'`.
- eClass, SIS, and pin-refresh tool paths open `/auth`, wait briefly for a refreshed session, and retry once before returning **`sessionExpiredPayload()`**.
- Cengage auth paths return `auth_required` with retry guidance through their Cengage-specific response schemas.

### Phase 1b â€” Secure session storage (`SESSION_STORAGE_UNAVAILABLE`)

- **`SecureSessionStorageError`** ([`src/security/secure-session-store.ts`](../src/security/secure-session-store.ts)) carries `code: 'SESSION_STORAGE_UNAVAILABLE'`.
- `session.json` and `cengage-state.json` are encrypted secure-file envelopes using `ECLASS_MCP_SESSION_SECRET`.
- Missing/weak secret, wrong secret, malformed envelopes, and legacy plaintext sessions return structured `status: 'error'` with `retry.afterAuth=false`; tools do not open auth windows or wait for login in this state.
- The local auth server exposes `/logout` to clear auth session files without deleting cache, pins, debug output, or course-platform mappings.

### Phase 2 — Scraper drift (`SCRAPE_LAYOUT_CHANGED`)

- **`ScrapeLayoutError`** ([`src/scraper/scrape-errors.ts`](../src/scraper/scrape-errors.ts)) with optional **`context`** for debugging.
- E15 selector registry failures include selector group id, page type, tried selectors, selector counts, URL/title, and optional debug snapshot path when `ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS=1`.
- Example: file download HTML wrapper with no extractable direct URL ([`src/scraper/eclass/files.ts`](../src/scraper/eclass/files.ts)); tool layer [`src/tools/files.ts`](../src/tools/files.ts) maps to **`toErrorPayload('SCRAPE_LAYOUT_CHANGED', …)`**.

### Phase 3 — Network (`UPSTREAM_ERROR`, `RATE_LIMITED`, `TIMEOUT`)

- **`UpstreamError`** + **`upstreamErrorFromHttpStatus`** + **`upstreamErrorFromUnknown`** in [`src/scraper/scrape-errors.ts`](../src/scraper/scrape-errors.ts).
- **RMP** ([`src/scraper/rmp.ts`](../src/scraper/rmp.ts)): `fetch` failures, non-OK HTTP, invalid JSON, GraphQL `errors` in the response body, and local circuit-breaker fail-fast protection after repeated upstream failures.
- **File download** ([`src/scraper/eclass/files.ts`](../src/scraper/eclass/files.ts)): Playwright `request.get` non-OK responses; other Playwright/network errors mapped via **`upstreamErrorFromUnknown`**.
- Runtime timeout, concurrency, retry, and rate-limit posture is documented in [`docs/operational-limits.md`](./operational-limits.md).
- **Tools:** [`src/tools/rmp.ts`](../src/tools/rmp.ts), [`src/tools/files.ts`](../src/tools/files.ts) return **`EclassToolErrorResponseSchema`** with **`toErrorPayload(error.code, …)`** and optional **`details.httpStatus`**.

### Phase 4 — Validation (`VALIDATION_FAILED`)

- **`ValidationError`** ([`src/errors/validation-error.ts`](../src/errors/validation-error.ts)) with optional **`details`** (e.g. `{ field: 'url' }`, `{ scope: 'range', missing: ['from'] }`).
- **Deadlines** ([`src/tools/deadlines.ts`](../src/tools/deadlines.ts)):
  - `get_deadlines` with `scope: 'range'` but missing **`from`** / **`to`**, or invalid boundary dates.
  - `get_item_details` when **`url`** is missing or empty.
- **RMP** ([`src/tools/rmp.ts`](../src/tools/rmp.ts)): missing **`name`** (search) or **`teacherId`** (details) — returned as JSON with **`VALIDATION_FAILED`** instead of MCP **`InvalidParams`** (see §5).

---

### Phase 5 — Future writes (E20)

- Missing `preflightRef` is **`WRITE_PREFLIGHT_REQUIRED`**, not an auth failure.
- Expired `preflightRef` is **`WRITE_PREFLIGHT_EXPIRED`**, not an internal failure; call the prepare tool again.
- Ambiguous target resolution is **`WRITE_TARGET_AMBIGUOUS`** unless the DOM itself cannot be interpreted, in which case use **`SCRAPE_LAYOUT_CHANGED`**.
- Changed course, assignment title, due date, submission state, upload slots, or intended file facts after preflight is **`WRITE_PLATFORM_STATE_CHANGED`**. The model/user must call the prepare tool again before retrying the write.
- Missing `confirm: true` is **`WRITE_CONFIRMATION_REQUIRED`**.

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

| Area                   | Files                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Codes                  | `src/errors/codes.ts`                                                       |
| Payload helpers        | `src/errors/tool-error.ts`                                                  |
| Validation errors      | `src/errors/validation-error.ts`                                            |
| Scraper errors         | `src/scraper/scrape-errors.ts`                                              |
| Session                | `src/scraper/session.ts`                                                    |
| Secure session storage | `src/security/secure-session-store.ts`, `src/security/auth-session-wipe.ts` |
| RMP client             | `src/scraper/rmp.ts`                                                        |
| eClass barrel exports  | `src/scraper/eclass.ts`                                                     |
| Zod contracts          | `src/tools/eclass-contracts.ts`                                             |
| Write preflight        | `src/tools/write-contracts.ts`, `src/tools/write-preflight-ref.ts`          |
| Validation wrapper     | `src/tools/mcp-validated-response.ts`                                       |
| Tools (representative) | `src/tools/deadlines.ts`, `src/tools/files.ts`, `src/tools/rmp.ts`          |

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
