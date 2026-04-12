# `get_class_timetable`

## Features

- Scrapes personal class timetable from York SIS for active session.
- Returns structured timetable entries (course, section, time, location).
- Session-expiry path reuses auth-reopen behavior.

## Known Problems

- SIS session-selection pages may change URL/structure.
- Inconsistent room/instructor formatting across rows.

## Tests

- Prompt: "What is my class schedule?"
- E2E rows in `docs/e2e-run-log.md`.

## Edge Cases

- No timetable entries for selected term.
- Split activities (LECT/LAB/TUTR) with partial fields.

## Technical Notes

- Source: `src/tools/sis.ts` -> `SISScraper.scrapeTimetable()`.
- Depends on SIS cookie capture during `/auth`.
