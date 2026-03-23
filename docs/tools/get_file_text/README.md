# `get_file_text`

## Features
- Extracts content from PDF/DOCX/PPTX course files.
- PDF path uses hybrid analyzer (`text` + rendered images when needed).
- Supports page ranges via `startPage` / `endPage`.
- Cache key format: `file_<md5(url)>_v2[_pX-Y]`.

## Known Problems
- Very large files can produce big payloads.
- Cached schema still uses manual version suffix (`v2`).

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
