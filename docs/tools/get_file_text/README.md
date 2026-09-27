# `get_file_text`

## Features

- Extracts content from PDF/DOCX/PPTX course files.
- PDF path uses the shipped hybrid analyzer (`text` + rendered images when needed).
- T22 PDF pipeline work is complete: page-level image detection, payload strategy, and mixed content blocks are implemented.
- Supports page ranges via `startPage` / `endPage`.
- Cache keys use the shared cache schema helper: `getCacheKey("file", fileUrl, optionalPageRange)`, stored as versioned `v1_file_*.json` filenames under `.eclass-mcp/cache/`.

## Data source

1. **Mobile token (preferred when available).** If a Moodle mobile credential is stored and the URL is a `pluginfile.php` URL, the file is fetched from `/webservice/pluginfile.php` with the token (ADR 0011). No browser is launched. The token is appended only after URL-policy validation and never appears in logs, cache keys, or pins.
2. **Playwright (fallback).** Wrapper pages (`/mod/resource/view.php`, `/mod/folder/view.php`, `/mod/url/view.php`) and any token failure (missing or invalid token, JSON error envelope, HTML/WAF response, size cap) use the existing authenticated browser download.

The choice happens inside the eClass provider's `downloadFile`, so parsing, caching, and the tool output contract are unchanged.

## Known Problems

- Very large files can produce big payloads.
- PDF page ranges are now validated before extraction; impossible ranges return a controlled message instead of processing invalid pages.

## Tests

- MCP prompt: "Read this file: <fileUrl>."
- Scripts: `scripts/test-pdf-parser.ts`, `scripts/debug-file-url.ts`.
- Deep-dive docs: `docs/tools/get_file_text/history.md`, `roadmap.md`.

## Edge Cases

- Scanned PDFs with little/no embedded text.
- Unsupported file MIME types.
- Large PDFs requiring pagination.

## Technical Notes

- Source: `src/tools/files.ts`; download routing in `src/scraper/eclass/api/hybrid.ts` and `src/scraper/eclass/api/token-files.ts`.
- Parsers: `src/parser/pdf-analyzer.ts`, `src/parser/docx.ts`, `src/parser/pptx.ts`.
- TTL: `TTL.FILES`.
