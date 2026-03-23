# `search_professors`

## Features
- Searches RateMyProfessors for York faculty profiles.
- Required arg: `name`; optional campus filter.
- Caches search responses for repeated lookups.

## Known Problems
- External GraphQL token/shape can change.
- Name matching quality depends on RMP indexing and query terms.

## Tests
- Prompt: "Search RateMyProfessors for professor <name>."
- Script: `npx ts-node scripts/test-rmp-fetch.ts` (if available locally).

## Edge Cases
- No matches for uncommon spellings.
- Multiple professors with similar names.

## Technical Notes
- Source: `src/tools/rmp.ts` (`searchProfessorsTool`).
- Uses `RMPClient.searchTeachers(name, campus)`.
- Cache key format: `rmp_search_<name>_<campus|all>`.
