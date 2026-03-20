# Vision Image Reading (No OCR) for `get_item_details`

This page documents how Claude can read instruction screenshots directly from eClass assignment/quiz pages using the MCP tool `get_item_details`.

## Why this exists
Some eClass assignments/quizzes embed the instructions as images (screenshots). Since we are **not using OCR**, the only way for the model to “read” the instructions is to attach the images and let Claude use vision.

MCP responses have a limited payload size, so we must attach images with strict caps.

## Tool: `eclass:get_item_details`
### Args
All args are optional except `url`.

- `url` (string, required): assignment or quiz URL
- `includeImages` (boolean, optional): if `true`, attach instruction images (no OCR)
- `maxImages` (number, optional): max number of instruction images to attach (default `3`)
- `imageOffset` (number, optional): pagination offset into the instruction image list (default `0`)
- `maxTotalImageBytes` (number, optional): maximum base64 payload budget for attached images (default `750000`)
- `includeCsv` (boolean, optional): if `true`, inline linked CSV attachments as text (no parsing heuristics)
- `csvMode` (auto|full|preview, optional): controls full vs preview inlining (default `auto`)
- `maxCsvBytes` (number, optional): maximum bytes to inline for CSV (default `200000`)
- `csvPreviewLines` (number, optional): when previewing, max number of lines to include (default `200`)
- `maxCsvAttachments` (number, optional): max number of CSV attachments to inline (default `3`)

### What the tool returns
The tool always returns MCP `content`:

1. A first `text` block containing JSON metadata (always)
2. If `includeImages=true`, additional `image` blocks (base64) for the selected images
3. If `includeCsv=true`, one or more additional `text` blocks containing inlined CSV contents (full/preview)

The first JSON metadata object includes:

- `imageTotalCount`: total number of instruction images found in `descriptionHtml`
- `imageOffset`: the offset the tool started from
- `imagesReturnedCount`: how many images were attached in this call
- `imagesSkippedByBudget`: how many were skipped due to the payload cap or unsupported image types
- `imagesRemainingCount`: how many instruction images are left to fetch
- `nextImageOffset`: the offset to use for the next fetch (if `imagesRemainingCount > 0`)
- CSV metadata fields (when `includeCsv=true`):
  - `csvTotalAttachments`
  - `csvIncludedCount`
  - `csvSkippedCount`

## How to use it from Claude (permission for leftovers)
When the JSON metadata shows `imagesRemainingCount > 0`, Claude should:
1) Explain that it attached only a subset due to MCP payload limits
2) Ask the user for permission to fetch the remaining images
3) If permitted, call `eclass:get_item_details` again with:
   - `includeImages=true`
   - `imageOffset = nextImageOffset`
   - the same `maxImages` and `maxTotalImageBytes`

## Attachments (“crazy delivery methods”)
`get_item_details` also extracts downloadable resources linked from the assignment/quiz page as `attachments` when available.

- For PDFs/DOCX/PPTX (and images), Claude can often use existing tools (like `get_file_text`) for deeper extraction.
- For CSV: if `includeCsv=true`, the tool will inline the CSV as text (full/preview) with strict byte/line caps.
- For other formats: treat extraction as best-effort (the tool lists URLs, but does not parse unknown binaries).

