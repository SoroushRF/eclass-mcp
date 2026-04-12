# `get_upcoming_deadlines`

## Features

- Fast path for future deadlines from eClass upcoming timeline.
- Optional `courseId` filter.
- Backward-compatible legacy tool retained alongside `get_deadlines`.

## Known Problems

- `daysAhead` argument is currently not actively filtering server-side.
- Depends on how eClass populates "upcoming" timeline.

## Tests

- MCP prompt: "What's due in the next two weeks?"
- Script: `npx ts-node scripts/test-deadlines.ts`.
- E2E matrix row in `docs/t11-e2e-handbook.md`.

## Edge Cases

- No upcoming events in selected period.
- Course IDs with no assignment/quiz events.

## Technical Notes

- Source: `src/tools/deadlines.ts` (`getUpcomingDeadlines`).
- Cache key format: `deadlines_v3_<course|all>`.
- TTL: `TTL.DEADLINES`.
