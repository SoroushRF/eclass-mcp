# `get_exam_schedule`

## Features

- Scrapes personal exam schedule from York SIS.
- Uses SIS-authenticated cookies bridged by auth flow.
- Returns human-readable text with JSON payload content.

## Known Problems

- SIS page structures can change across terms.
- If SIS cookies are missing, auth must be refreshed.

## Tests

- Prompt: "What are my upcoming exams?"
- Script: `npx ts-node scripts/archive/test-sis-scraper.ts` (archived probe, optional).
- E2E rows in `docs/e2e-run-log.md`.

## Edge Cases

- No exams posted for current student/session.
- Session selector changes in SIS workflow.

## Technical Notes

- Source: `src/tools/sis.ts` -> `SISScraper.scrapeExams()`.
- Auth bridge source: `src/auth/server.ts`.
