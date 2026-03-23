# `get_section_text`

## Features
- Extracts section main text, links, and custom tab content from a section URL.
- Cache key format: `sectiontext_v5_<sanitizedUrl>`.
- Useful for rich sections where `get_course_content` only gives summaries/links.

## Known Problems
- Some deeply custom HTML blocks may produce noisy text.
- Cache key versioning is manual (`v5`).

## Tests
- MCP prompt: "Open this section URL and summarize the text: <url>."
- Script: `npx ts-node scripts/test-section-text.ts` (if available locally).
- E2E matrix row in `docs/t11-e2e-handbook.md`.

## Edge Cases
- URL points outside section pages.
- Tabbed content loaded dynamically by theme/plugin.

## Technical Notes
- Source: `src/tools/content.ts` (`getSectionText()`).
- Uses `scraper.getSectionText(url)` and `TTL.CONTENT`.
