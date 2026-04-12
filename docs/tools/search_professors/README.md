# `search_professors`

## Features

- Searches RateMyProfessors for York faculty profiles.
- Required arg: `name`; optional campus filter.
- Caches search responses for repeated lookups.

## Known Problems

- External GraphQL token/shape can change.
- Name matching quality depends on RMP indexing and query terms.
- If a campus-specific search returns zero matches, the tool automatically runs a cross-campus probe and adds
  `diagnostics` so you can tell whether the problem looks like a stale school ID or a genuine no-match case.

## Tests

- Prompt: "Search RateMyProfessors for professor <name>."
- Script: `npx ts-node scripts/archive/test-rmp-fetch.ts` (archived probe, optional).

## Edge Cases

- No matches for uncommon spellings.
- Multiple professors with similar names.

## Technical Notes

- Source: `src/tools/rmp.ts` (`searchProfessorsTool`).
- Uses `RMPClient.searchTeachers(name, campus)`.
- Cache key format: `rmp_search_<name>_<campus|all>`.
- York campus IDs are read from live browser GraphQL traffic and should stay in sync with RMP:
  - Keele: `U2Nob29sLTE0OTU=`
  - Glendon: `U2Nob29sLTEyMTI1`
  - Markham: `U2Nob29sLTE5Mzcy`
- Search responses may include:
  - `diagnostics.suspectedSchoolIdIssue`
  - `diagnostics.usedCrossCampusProbe`
  - `diagnostics.note`
