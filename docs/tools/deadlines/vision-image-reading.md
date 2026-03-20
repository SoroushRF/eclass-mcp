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

### What the tool returns
The tool always returns MCP `content`:

1. A first `text` block containing JSON metadata (always)
2. If `includeImages=true`, additional `image` blocks (base64) for the selected images

The first JSON metadata object includes:

- `imageTotalCount`: total number of instruction images found in `descriptionHtml`
- `imageOffset`: the offset the tool started from
- `imagesReturnedCount`: how many images were attached in this call
- `imagesSkippedByBudget`: how many were skipped due to the payload cap or unsupported image types
- `imagesRemainingCount`: how many instruction images are left to fetch
- `nextImageOffset`: the offset to use for the next fetch (if `imagesRemainingCount > 0`)

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
- For CSV/other formats, Claude should treat extraction as best-effort unless a dedicated parser exists.

