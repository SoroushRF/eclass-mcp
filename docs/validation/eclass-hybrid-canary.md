# eClass hybrid canary gates

**Branch:** `feat/eclass-hybrid-api`  
**Safe default:** `ECLASS_API_SOURCE_MODE=playwright`  
**Live account data:** not collected by automated tests

## Automated gates

The API and Playwright providers are compared through domain models, never by
logging raw Moodle JSON or HTML:

- Courses require equal normalized `(id, name, courseCode)` sets.
- Course outlines require equal visible section counts and module sets.
  Incomplete `numsections` coverage remains Playwright-backed.
- Deadlines require equal stable event IDs and exact normalized ISO timestamps.
- Shadow mode returns Playwright data and records only counts, mismatch
  categories, durations, and safe error codes.
- API-primary mode performs at most one read-only Playwright fallback. A valid
  empty API response is returned as empty; session expiry and rate limiting are
  not converted into browser traffic.

Focused automated commands:

```text
npm.cmd exec vitest run tests/eclass-api-canary.test.ts tests/eclass-hybrid-provider.test.ts
npm.cmd run typecheck
npm.cmd run typecheck:tests
```

## Local account-owner acceptance

Before changing the source mode from `playwright`, run the three reads against
the account owner’s current eClass account with a cold cache and repeat after
re-authentication:

1. `list_courses`: compare course IDs, normalized names, course codes, URLs,
   count, and stable ordering.
2. `get_course_content`: compare visible sections/modules on a small course, a
   larger course, and a course containing an LTI/Cengage/WebAssign link.
3. `get_deadlines`: compare upcoming, month, and range scopes, including a
   current-term event, a past event, an empty result, and a timezone boundary.

Do not paste cookies, `sesskey`, mobile tokens, `Location` headers, response
bodies, screenshots, or account-specific URLs into commits, CI, chat, or
shared logs. Record only pass/fail, counts, mismatch categories, and the
source mode.

## Rollback

Set the source mode back to Playwright and restart the local MCP host:

```text
ECLASS_API_SOURCE_MODE=playwright
```

The API session context is closed during logout and shutdown. Account-scoped
cache entries remain isolated; clear only affected unpinned entries if a
promotion changes the normalized model.

## REST status

The mobile launch and capability-gated REST client are intentionally not
promoted to user-facing tools yet. Grades, forums, assignment details,
submission preflight, and plugin-file reads remain Playwright-backed until each
function has a separate account-owner validation record and output comparison.
