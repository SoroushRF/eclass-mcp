# `get_upcoming_deadlines`

`get_upcoming_deadlines` is eClass-only and kept for backward compatibility. For the complete assignment path across eClass and Cengage/WebAssign, prefer `get_assignments`.

## Features

- Fast path for future deadlines from eClass upcoming timeline.
- Optional `courseId` filter.
- Backward-compatible legacy tool retained alongside `get_deadlines`.
- Empty eClass results include `recommendedTool: "get_assignments"` so clients know to run the cross-platform resolver.

## Known Problems

- `daysAhead` argument is currently not actively filtering server-side.
- Depends on how eClass populates "upcoming" timeline.
- Does not inspect Cengage/WebAssign; empty eClass timeline output is not final for courses using external platforms.

## Tests

- MCP prompt: "What's due in the next two weeks?"
- Script: `npx ts-node scripts/test-deadlines.ts`.
- E2E matrix row in `docs/t11-e2e-handbook.md`.

## Edge Cases

- No upcoming events in selected period.
- Course IDs with no assignment/quiz events.

## Technical Notes

- Source: `src/tools/deadlines.ts` (`getUpcomingDeadlines`).
- Cache keys use the shared cache schema helper: `getCacheKey("deadlines", "upcoming", courseId || "all")`, stored as versioned `v1_deadlines_*.json` filenames.
- TTL: `TTL.DEADLINES`.
