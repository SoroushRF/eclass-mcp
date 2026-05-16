# `get_file_text`

## Features

- Extracts content from PDF/DOCX/PPTX course files.
- PDF path uses the shipped hybrid analyzer (`text` + rendered images when needed).
- T22 PDF pipeline work is complete: page-level image detection, payload strategy, and mixed content blocks are implemented.
- Supports page ranges via `startPage` / `endPage`.
- Cache keys use the shared cache schema helper: `getCacheKey("file", fileUrl, optionalPageRange)`, stored as versioned `v1_file_*.json` filenames under `.eclass-mcp/cache/`.

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

- Source: `src/tools/files.ts`.
- Parsers: `src/parser/pdf-analyzer.ts`, `src/parser/docx.ts`, `src/parser/pptx.ts`.
- TTL: `TTL.FILES`.
