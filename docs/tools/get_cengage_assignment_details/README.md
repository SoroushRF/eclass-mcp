# `get_cengage_assignment_details`

## Features

- Opens a selected Cengage/WebAssign assignment and extracts question-level details.
- Supports assignment selection by `assignmentId`, `assignmentUrl`, or `assignmentQuery`.
- Includes prompt text, prompt sections, scoring/result hints, feedback, and resource links.
- Supports additive extraction metadata:
  - `extractionWarnings`
  - `completenessLevel`
  - `extractionOverview`
  - `interactiveAssets`
  - `mediaAssets`
- Supports rendered-media fallback metadata parity for image-classified prompts.
- Returns structured status values and `_cache` freshness metadata.

## Recommended Call Patterns

- Typical path:
  1. Call `list_cengage_courses` to identify the course.
  2. Call `get_cengage_assignments` to identify the assignment.
  3. Call `get_cengage_assignment_details` with `assignmentId` (preferred) or `assignmentUrl`.
- Use `assignmentQuery` only when an exact id/url is unavailable.

## Inputs and Limits

- Selection inputs: `assignmentId`, `assignmentUrl`, `assignmentQuery`.
- Course selectors: `courseId`, `courseKey`, `courseQuery`.
- Legacy compatibility: accepts `entryUrl` and `ssoUrl` when explicit-link routing is needed.
- Text limits:
  - `maxQuestions`
  - `maxQuestionTextChars`
  - `maxAnswerTextChars`
- Optional detail controls:
  - `includeAnswers`
  - `includeResources`
  - `includeAssetInventory`
  - `includeRenderedMedia`

## Known Problems

- Very long multi-part prompts can still truncate under configured character caps.
- Rendered-media fallback may skip captures when payload/limit guards are reached.
- Platform UI variations can alter available per-question markers.

## Tests

- `tests/cengage-assignment-details-tool.test.ts`

## Technical Notes

- Source: `src/tools/cengage.ts` (`getCengageAssignmentDetails`).
- Schemas: `src/tools/cengage-contracts.ts` (`GetCengageAssignmentDetailsInputSchema`, `GetCengageAssignmentDetailsResponseSchema`).
- Scraper path: `src/scraper/cengage.ts` (`getAssignmentDetails`) and `src/scraper/cengage/assignment-details.ts`.
- Cache key scope: `cengage/assignment_details` with `TTL.DEADLINES`.
