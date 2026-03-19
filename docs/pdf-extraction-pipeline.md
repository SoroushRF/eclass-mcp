# PDF Extraction Pipeline — Architecture & Implementation Plan

> This document explains eClass MCP's file extraction pipeline end-to-end, diagnoses the
> image-content limitation, and lays out a multi-task plan to implement intelligent
> per-page extraction with image support.

---

## Table of Contents

1. [Current Architecture](#1-current-architecture)
2. [The Problem: Invisible Image Content](#2-the-problem-invisible-image-content)
3. [Solution: Metadata-First Per-Page Intelligence](#3-solution-metadata-first-per-page-intelligence)
4. [Implementation Tasks](#4-implementation-tasks)
5. [Caching Strategy](#5-caching-strategy)
6. [Token & Performance Budget](#6-token--performance-budget)

---

## 1. Current Architecture

### Data Flow

When Claude asks to read a course file, the request travels through four layers:

```
Claude Desktop
     │
     ▼
┌─────────────────┐   MCP tool call: get_file_text(courseId, fileUrl)
│   index.ts       │   Registers the tool with the MCP SDK
└────────┬────────┘
         ▼
┌─────────────────┐   Orchestration layer
│   tools/files.ts │   Checks cache → calls scraper → calls parser → returns result
└────────┬────────┘
         ▼
┌─────────────────┐   Network layer
│ scraper/eclass.ts│   downloadFile() → HTTP request with auth cookies → follows redirects
│                  │   Handles Moodle HTML wrapper pages and AWS WAF bot challenges
└────────┬────────┘
         ▼
┌─────────────────┐   Parsing layer
│  parser/pdf.ts   │   pdf-parse → getText() → returns plain text string
│  parser/docx.ts  │   mammoth → extractRawText() → returns plain text string
│  parser/pptx.ts  │   adm-zip → XML tag stripping → returns plain text string
└────────┬────────┘
         ▼
Claude receives:  { content: [{ type: "text", text: "..." }] }
```

### Key Files

| File | Role |
|------|------|
| `src/index.ts` | MCP server entry point. Registers the `get_file_text` tool. |
| `src/tools/files.ts` | **Orchestrator.** Checks cache, calls `downloadFile`, routes to parser by mime/extension, returns MCP content blocks. |
| `src/scraper/eclass.ts` | **Network.** `downloadFile()` fetches the raw file buffer via authenticated HTTP. Handles Moodle view.php wrapper pages and AWS WAF challenges. |
| `src/parser/pdf.ts` | **PDF parser.** Uses `pdf-parse` to extract the text layer. |
| `src/parser/docx.ts` | **DOCX parser.** Uses `mammoth` to extract raw text from Word docs. |
| `src/parser/pptx.ts` | **PPTX parser.** Uses `adm-zip` to read slide XML and strip tags. |
| `src/cache/store.ts` | **Cache.** File-based JSON cache with configurable TTL. Parsed file text is cached for 7 days. |

### What Gets Returned to Claude

Currently, the MCP response is always a **single text block**:

```typescript
return { content: [{ type: 'text', text: extractedText }] };
```

The MCP protocol also supports **image blocks**:

```typescript
{ type: 'image', data: '<base64>', mimeType: 'image/png' }
```

This is unused today — and is the key to solving the image content problem.

---

## 2. The Problem: Invisible Image Content

### What `pdf-parse` Actually Does

The `pdf-parse` library reads only the **text layer** of a PDF. A PDF is internally composed
of multiple content streams per page, containing different types of drawing operations:

| Content Type | PDF Internal Representation | Extracted by pdf-parse? |
|---|---|---|
| Typed text (LaTeX, Word-generated) | Text drawing operators (`Tj`, `TJ`) | ✅ Yes |
| Embedded images (photos, scans, diagrams) | Image XObjects (JPEG/PNG binary data) | ❌ No |
| Text *inside* an image (e.g., scanned worksheet) | Part of the image binary — just pixels | ❌ No |
| Vector graphics (drawn shapes, arrows) | Path drawing operators | ❌ No |
| Mathematical notation (if image-based) | Image XObject | ❌ No |

### Real-World Impact

A typical calculus lecture PDF (e.g., MATH 1014) contains:
- **Typed content**: section headers, definitions, theorem statements → extracted fine
- **Embedded images**: practice problems photographed from textbooks, hand-drawn diagrams,
  graphing calculator screenshots → **completely invisible to Claude**

Claude sees the lecture skeleton but misses the actual questions — which is usually the most
important part the student wants help with.

---

## 3. Solution: Metadata-First Per-Page Intelligence

### Core Idea

Instead of blindly extracting all text or rendering all pages, **analyze each page's internal
structure first**, then choose the cheapest extraction method that captures all content.

### How PDF Page Analysis Works

The `pdfjs-dist` library (Mozilla's PDF.js for Node) provides two key APIs per page:

1. **`page.getTextContent()`** → Returns all text items on the page with their positions
   - We count total characters to gauge how "text-heavy" a page is

2. **`page.getOperatorList()`** → Returns the raw draw command list for the page
   - We scan for image-drawing operators (`OPS.paintImageXObject`, `OPS.paintInlineImageXObject`)
   - If present, the page contains embedded images

### Decision Matrix

For each page, we classify it using both signals:

```
                    Has Images?
                   NO          YES
                ┌───────────┬───────────┐
  Text ≥ 50    │  TEXT      │  IMAGE    │
  chars         │  (cheap)  │  (mixed)  │
                ├───────────┼───────────┤
  Text < 50    │  TEXT*     │  IMAGE    │
  chars         │  (*empty) │  (scan)   │
                └───────────┴───────────┘
```

| Classification | Action | Cost |
|---|---|---|
| **TEXT** — Text-heavy, no images | Extract text via `getTextContent()` | ~50 tokens/page |
| **IMAGE** — Has embedded images (with or without text) | Render page as PNG at 150 DPI | ~1,600 tokens/page |
| **TEXT**** — Very little text, no images | Extract text (likely a blank/separator page) | ~10 tokens/page |

### Why This Is Optimal

- **Text-only pages** (80%+ of most lectures) stay cheap — no rendering needed
- **Image pages** (practice problems, diagrams) get rendered — Claude sees everything
- **Mixed pages** (text + diagram) are rendered as images — Claude reads both; rendering only
  costs slightly more than text extraction but captures all content
- **Analysis is fast** — `getOperatorList()` and `getTextContent()` are metadata reads, not renders

---

## 4. Implementation Tasks

> **Rules for implementation:**
> 1. Complete ONE task at a time.
> 2. After each task: verify with `npx tsc --noEmit`, then `npm run build`.
> 3. Test using `npx ts-node scripts/test-scraper.ts` or a targeted debug script.
> 4. NEVER move to the next task without explicit confirmation from the user.

---

### Task 1: Install & Configure `pdfjs-dist`

**Goal:** Replace `pdf-parse` with `pdfjs-dist` as the PDF processing engine.

**Why `pdfjs-dist`?**
- `pdf-parse` only does text extraction — no page-level analysis, no rendering
- `pdfjs-dist` is Mozilla's PDF.js, the same engine Firefox uses to view PDFs
- It supports per-page text extraction, operator list inspection, AND page rendering
- Pure JavaScript — no system-level dependencies (unlike `poppler` or `mupdf`)
- Actively maintained, handles complex PDFs well

**Steps:**
1. Install the package:
   ```bash
   npm install pdfjs-dist
   ```
2. `pdfjs-dist` in Node.js requires a "standard font data" path and a canvas implementation
   for rendering. We don't need a canvas for Task 1 (text-only), but we will in Task 4.
3. Create a new file `src/parser/pdf-analyzer.ts` that will replace `pdf.ts`.
   - This file will export the analysis and extraction functions.
4. Do **not** delete `pdf.ts` yet — we'll swap it in Task 5 after everything is tested.

**Notes:**
- `pdfjs-dist` uses ES modules internally. If there are import issues with CommonJS,
  use `await import('pdfjs-dist')` dynamic import or check for a `/legacy/` build path
  that's CJS-compatible.
- Set the worker to `null` for Node.js usage (no web worker in server context).

---

### Task 2: Implement Per-Page Metadata Analysis

**Goal:** For each page in a PDF, determine whether it is text-only, image-only, or mixed.

**File:** `src/parser/pdf-analyzer.ts`

**Steps:**
1. Create a function:
   ```typescript
   interface PageAnalysis {
     pageNum: number;      // 1-indexed
     textLength: number;   // character count from getTextContent()
     hasImages: boolean;    // true if paintImageXObject found in operator list
     classification: 'text' | 'image';
   }

   async function analyzePages(buffer: Buffer): Promise<PageAnalysis[]>
   ```
2. Load the PDF using `pdfjs-dist`:
   ```typescript
   const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
   const pdf = await loadingTask.promise;
   ```
3. For each page (1 to `pdf.numPages`):
   - Call `page.getTextContent()` → count total chars across all `items[].str`
   - Call `page.getOperatorList()` → scan `operatorList.fnArray` for:
     - `pdfjsLib.OPS.paintImageXObject` (operator code 85)
     - `pdfjsLib.OPS.paintInlineImageXObject` (operator code 86)
     - `pdfjsLib.OPS.paintImageXObjectRepeat` (operator code 88)
   - Classify the page using the decision matrix from Section 3

**Threshold Constants:**
```typescript
const MIN_TEXT_CHARS = 50;  // Below this, page is "text-sparse"
```

A page is classified as `'image'` if:
- `hasImages === true` (regardless of text length), **OR**
- `textLength < MIN_TEXT_CHARS` and `hasImages === true`

A page is classified as `'text'` if:
- `hasImages === false` (regardless of text length)

**Notes:**
- The operator list scan is very fast — it's just reading an array of numbers.
  No rendering happens here.
- Some PDFs use images for decorative elements (backgrounds, logos). These will trigger
  `hasImages = true` on pages that are really text-only. This is acceptable — rendering a
  text page as an image wastes some tokens but doesn't lose information. It's always safer
  to render than to skip.
- Math fonts sometimes use character-mapped glyphs that `getTextContent()` returns as
  garbled Unicode. If `textLength` is high but the text is unreadable, the image fallback
  still captures it correctly.

---

### Task 3: Implement Per-Page Text Extraction

**Goal:** Extract text from pages classified as `'text'`.

**File:** `src/parser/pdf-analyzer.ts`

**Steps:**
1. Create a function:
   ```typescript
   async function extractPageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string>
   ```
2. Use `page.getTextContent()` to get text items.
3. Reconstruct readable text from the items:
   - `getTextContent()` returns items with `str` (the text) and `transform` (position matrix).
   - Items on the same line share similar Y positions.
   - Group items by Y coordinate, sort by X within each group, join with spaces.
   - Join groups with newlines.
4. Apply the same whitespace normalization as the current `pdf.ts`:
   ```typescript
   text = text.replace(/\s+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
   ```

**Notes:**
- This replaces `pdf-parse`'s `getText()` with a more controlled extraction.
- The positional reconstruction (grouping by Y, sorting by X) is important for
  multi-column layouts and math content that has subscripts/superscripts.
- A simpler approach (just concatenating all `item.str` values) works for most
  lecture PDFs but may garble complex layouts.

---

### Task 4: Implement Per-Page Image Rendering

**Goal:** Render pages classified as `'image'` as PNG images for Claude's vision.

**File:** `src/parser/pdf-analyzer.ts`

**Steps:**
1. Install a canvas implementation for Node.js:
   ```bash
   npm install canvas
   ```
   (`canvas` provides `CanvasRenderingContext2D` for `pdfjs-dist` to draw into.)

2. Create a function:
   ```typescript
   async function renderPageAsImage(pdf: PDFDocumentProxy, pageNum: number, dpi: number = 150): Promise<Buffer>
   ```
3. Implementation:
   - Get the page: `const page = await pdf.getPage(pageNum);`
   - Calculate viewport at target DPI:
     ```typescript
     const scale = dpi / 72;  // PDF internal unit is 72 DPI
     const viewport = page.getViewport({ scale });
     ```
   - Create a canvas:
     ```typescript
     import { createCanvas } from 'canvas';
     const canvas = createCanvas(viewport.width, viewport.height);
     const ctx = canvas.getContext('2d');
     ```
   - Render:
     ```typescript
     await page.render({ canvasContext: ctx, viewport }).promise;
     ```
   - Export as PNG buffer:
     ```typescript
     return canvas.toBuffer('image/png');
     ```

4. **DPI Selection:**
   - 150 DPI is the default — good balance of readability vs. token cost (~1,600 tokens/page)
   - For very dense pages (small text), 200 DPI may be needed
   - 72 DPI is too blurry for equations; 300 DPI is overkill for most content

**Notes:**
- The `canvas` npm package requires native build tools (Python + C++ compiler).
  On Windows, this means Visual Studio Build Tools must be installed.
  If this is a problem, an alternative is `@napi-rs/canvas` which ships prebuilt binaries.
- Each page render takes ~0.5–2 seconds depending on complexity.
- Memory usage: a 150 DPI render of a standard page uses ~15MB of raw pixel data
  temporarily, compressed to ~200–500KB as PNG.
- The PNG buffer will be base64-encoded when returned to Claude, increasing size by ~33%.

---

### Task 5: Wire Up the New Parser in `files.ts`

**Goal:** Replace the current `parsePdf(buffer) → string` call with the new intelligent
pipeline that returns a mix of text and image content blocks.

**File:** `src/tools/files.ts`

**Steps:**
1. Create a new top-level function in `pdf-analyzer.ts`:
   ```typescript
   interface ContentBlock {
     type: 'text' | 'image';
     text?: string;          // present when type === 'text'
     data?: string;          // base64 PNG, present when type === 'image'
     mimeType?: string;      // 'image/png', present when type === 'image'
   }

   export async function parsePdfSmart(buffer: Buffer): Promise<ContentBlock[]>
   ```
2. This function combines Tasks 2–4:
   - Analyze all pages → get classifications
   - For `'text'` pages → extract text, create `{ type: 'text', text: ... }`
   - For `'image'` pages → render as PNG, create `{ type: 'image', data: base64, mimeType: 'image/png' }`
   - Return all blocks in page order

3. Update `files.ts`:
   ```typescript
   // Before:
   import { parsePdf } from '../parser/pdf';
   // ...
   text = await parsePdf(buffer);
   return { content: [{ type: 'text', text }] };

   // After:
   import { parsePdfSmart } from '../parser/pdf-analyzer';
   // ...
   const blocks = await parsePdfSmart(buffer);
   return { content: blocks };
   ```

4. Update the tool description in `index.ts` to reflect that the tool now returns images too:
   ```typescript
   "get_file_text" → "Extracts content from a course file (PDF, DOCX, PPTX). Returns text and/or images."
   ```

**Notes:**
- The MCP SDK's `content` array supports mixed content types — you can return both text
  and image blocks in the same response. Claude processes them in order.
- The old `parsePdf` function (`pdf.ts`) can be kept as a fallback or removed entirely.

---

### Task 6: Update Caching for Mixed Content

**Goal:** The current cache stores a single text string per file. We need to support caching
mixed text+image content blocks.

**File:** `src/cache/store.ts`, `src/tools/files.ts`

**Steps:**
1. The cache already supports generic types (`CacheStore.get<T>`, `CacheStore.set<T>`),
   so we can store `ContentBlock[]` directly.
2. Update `files.ts` cache logic:
   ```typescript
   // Before:
   const cached = cache.get<string>(cacheKey);
   if (cached) return { content: [{ type: 'text', text: cached }] };

   // After:
   const cached = cache.get<ContentBlock[]>(cacheKey);
   if (cached) return { content: cached };
   ```
3. Update the cache write:
   ```typescript
   // Before:
   cache.set(cacheKey, text, TTL.FILES);

   // After:
   cache.set(cacheKey, blocks, TTL.FILES);
   ```

**Notes:**
- Image blocks stored as base64 strings in JSON cache files will be large (~500KB per page).
  A 30-page PDF with 10 image pages = ~5MB cache file. This is fine for local disk.
- Consider compressing images before caching (lower quality PNG or JPEG conversion) to
  reduce cache file sizes.
- The 7-day TTL for files is still appropriate — lecture PDFs rarely change after upload.

---

### Task 7: Add Page Count Guardrails

**Goal:** Prevent excessive token usage and MCP response size for very large PDFs.

**File:** `src/parser/pdf-analyzer.ts`

**Steps:**
1. Add configuration constants:
   ```typescript
   const MAX_IMAGE_PAGES = 15;    // Max pages to render as images
   const MAX_TOTAL_PAGES = 50;    // Max pages to process at all
   const IMAGE_DPI = 150;         // Default render DPI
   ```
2. If a PDF has more than `MAX_TOTAL_PAGES` pages, truncate and add a note:
   ```typescript
   { type: 'text', text: `[Note: This PDF has ${totalPages} pages. Showing first ${MAX_TOTAL_PAGES}.]` }
   ```
3. If more than `MAX_IMAGE_PAGES` pages are classified as `'image'`, render only the first
   N and convert the rest to text (even if text extraction is sparse):
   ```typescript
   { type: 'text', text: `[Page ${n}: Contains images that could not be rendered (page limit reached).]` }
   ```
4. Log a summary to stderr for debugging:
   ```typescript
   console.error(`[PDF] ${totalPages} pages: ${textPages} text, ${imagePages} image (${renderedPages} rendered)`);
   ```

**Notes:**
- These guardrails protect against a 200-page course pack being sent as 200 PNG images.
- The limits are conservative — Claude's context window can handle ~120 images at 150 DPI,
  but leaving room for the conversation itself is important.

---

### Task 8: Testing & Validation

**Goal:** Verify the new pipeline works against real eClass files end-to-end.

**Steps:**
1. Modify `scripts/test-scraper.ts` to test the new `parsePdfSmart` function:
   - Download a known PDF (e.g., MATH 1014 Lecture 28)
   - Run `parsePdfSmart(buffer)`
   - Log: number of pages, classification of each, text lengths, image sizes
   - Write rendered images to `.eclass-mcp/debug/` for manual inspection

2. Create a standalone test script `scripts/test-pdf-parser.ts`:
   - Accept a local PDF file path as argument
   - Run the analysis + extraction pipeline
   - Output a report of page classifications and content previews

3. **Validation checklist:**
   - [ ] Text-only PDF → all pages classified as `'text'`, no images rendered
   - [ ] Image-only PDF (scanned doc) → all pages classified as `'image'`, all rendered
   - [ ] Mixed PDF (lecture with embedded questions) → correct per-page classification
   - [ ] Cache stores and retrieves mixed content blocks correctly
   - [ ] Claude Desktop receives and displays both text and images in the MCP response
   - [ ] Large PDFs (30+ pages) are handled within guardrails
   - [ ] `npm run build` succeeds with no TypeScript errors
   - [ ] Total processing time for a 20-page mixed PDF < 30 seconds

---

## 5. Caching Strategy

### Current
| What's cached | Format | TTL | Location |
|---|---|---|---|
| Extracted text | `string` | 7 days | `.eclass-mcp/cache/file_<md5>.json` |

### After Implementation
| What's cached | Format | TTL | Location |
|---|---|---|---|
| Content blocks (text + base64 images) | `ContentBlock[]` | 7 days | `.eclass-mcp/cache/file_<md5>.json` |

### Cache Invalidation
- Manual: delete the file from `.eclass-mcp/cache/`
- Automatic: TTL expiry (7 days)
- Full reset: `cache.clear()` removes all cached data

---

## 6. Token & Performance Budget

### Token Cost Comparison (30-page mixed lecture PDF)

| Method | Text pages (25) | Image pages (5) | Total tokens |
|---|---|---|---|
| **Current** (text-only) | ~3,750 | 0 (invisible) | ~3,750 |
| **New** (hybrid) | ~3,750 | ~8,000 | ~11,750 |
| **All-image** (naive) | ~40,000 | ~8,000 | ~48,000 |

The hybrid approach uses **3.1× more** tokens than text-only, but captures **100%** of content.
The naive all-image approach would use **12.8×** more — the hybrid saves 75% of that overhead.

### Processing Time Budget

| Step | Time |
|---|---|
| Download file | 1–3s |
| Analyze all pages (metadata) | 0.5–1s |
| Extract text (25 text pages) | 0.2s |
| Render images (5 image pages) | 2.5–10s |
| **Total** | **4–14s** |

This is acceptable for an on-demand tool call. Cached responses return in <100ms.
