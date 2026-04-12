# `discover_cengage_links`

## Features
- Scans arbitrary text for Cengage/WebAssign URL candidates.
- Detects direct registration-style entry links such as `getenrolled.com` course-key URLs.
- Normalizes and classifies links (`eclass_lti`, `webassign_course`, `webassign_dashboard`, `cengage_dashboard`, `cengage_login`, `other`).
- Preserves source context via `source`, `sourceHint`, and optional `sourceFile` metadata.
- Returns structured status and `_cache` freshness metadata.

## Known Problems
- Discovery quality depends on URLs being present in raw text.
- Heuristics cannot infer hidden links from paraphrased prose.
- Some edge hosts may classify as `other` until new patterns are added.

## Tests
- `tests/cengage-url.test.ts`
- `tests/cengage-file-link-mining.test.ts`
- `tests/cengage-fixtures.test.ts`

## Edge Cases
- Text with malformed URLs or heavy punctuation around links.
- Duplicate links across repeated blocks with mixed confidence values.
- File-text discoveries where only partial metadata is available.

## Technical Notes
- Source: `src/tools/cengage.ts` (`discoverCengageLinks`, `discoverCengageLinksFromText`, `discoverCengageLinksFromFileBlocks`).
- Schemas: `src/tools/cengage-contracts.ts` (`DiscoverCengageLinksInputSchema`, `DiscoverCengageLinksResponseSchema`).
- Cache key scope: `cengage/discover_links` with `TTL.CONTENT`.
