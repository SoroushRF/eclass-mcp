# `get_item_details`

## Features

- Opens one assignment/quiz URL and extracts:
  - core details (`kind`, title, fields)
  - optional instruction images (`includeImages`)
  - optional CSV attachment inlining (`includeCsv`)
- Supports payload controls (`maxImages`, `imageOffset`, CSV limits).

## Data source

Playwright only. Assignment and quiz detail pages carry attachments, instruction images, and rendered description HTML that the REST functions do not return in the same form, so this tool is not routed to REST yet.

## Known Problems

- Grade extraction still misses some quiz layouts.
- Assignment description extraction can miss authored mixed media in edge pages.

## Tests

- Prompt: "Get full details for this assignment/quiz URL <url>."
- Script: `npx ts-node scripts/test-item-details.ts`.
- Related issue tracking (archived): `docs/archive/tools/deadlines/failed-prompts-investigation-plan.md`.

## Edge Cases

- Non-assignment/non-quiz URLs.
- Pages with many large images exceeding payload budget.
- CSV encoding/content anomalies.

## Technical Notes

- Source: `src/tools/deadlines.ts` (`getItemDetails`).
- Caches details with key prefix `details_..._v3`.
- TTL: `TTL.DETAILS`.
- Uses scraper file-download path for image and CSV attachments.
