/**
 * Smart PDF Extraction Pipeline
 *
 * Uses pdfjs-dist (legacy build, loaded via dynamic import for CJS compat)
 * to analyse each page's metadata and choose the cheapest extraction strategy
 * that captures all content — text OR rendered image.
 */

// Type-only imports (stripped at compile time – safe in CJS)
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { createCanvas } from '@napi-rs/canvas';

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-loaded pdfjs-dist (ESM-only, must use dynamic import in CJS projects)
// ─────────────────────────────────────────────────────────────────────────────
let _pdfjs: any = null;

async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!_pdfjs) {
    _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any);
  }
  return _pdfjs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ContentBlock {
  type: 'text' | 'image';
  text?: string;
  data?: string;      // base64 PNG for image
  mimeType?: string;  // image/png
}

export interface PageAnalysis {
  pageNum: number;       // 1-indexed
  textLength: number;    // Character count from getTextContent()
  hasImages: boolean;    // True if paintImageXObject or similar is found
  classification: 'text' | 'image';
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const MAX_IMAGE_PAGES = 20;    // Max pages rendered as images per call
const MAX_TOTAL_PAGES = 50;    // Max pages processed in a single call
const DEFAULT_DPI = 100;       // Resolution for image rendering (100 DPI is safe for MCP payloads)
const MIN_TEXT_CHARS = 50;     // Threshold to avoid empty/garbage pages
const MIN_TEXT_FOR_SAFE_TEXT = 250; // Threshold: if text > this, we trust extraction even if logos exist
const MAX_PAYLOAD_BYTES = 800 * 1024; // 800KB safety limit for the total Base64 payload (MCP limit is 1MB)

// ─────────────────────────────────────────────────────────────────────────────
// Overview & Warning Blocks
// ─────────────────────────────────────────────────────────────────────────────

function buildOverviewBlock(
  totalPages: number,
  processedRange: [number, number],
  textPageCount: number,
  renderedImageCount: number,
  skippedImageCount: number,
  isTruncated: boolean
): ContentBlock {
  let overview = `📄 Document Overview\n`;
  overview += `━━━━━━━━━━━━━━━━━━━\n`;
  overview += `Total pages in PDF: ${totalPages}\n`;
  overview += `Pages in this response: ${processedRange[0]}–${processedRange[1]} of ${totalPages}\n`;
  overview += `  • Text pages: ${textPageCount} (extracted as text)\n`;
  overview += `  • Image pages rendered: ${renderedImageCount}\n`;
  if (skippedImageCount > 0) {
    overview += `  • Image pages skipped (render limit): ${skippedImageCount}\n`;
  }

  if (isTruncated) {
    overview += `\n⚠️ PARTIAL CONTENT WARNING\n`;
    overview += `This response contains only pages ${processedRange[0]}–${processedRange[1]} of ${totalPages}.\n`;
    overview += `Pages ${processedRange[1] + 1}–${totalPages} were NOT accessed.\n`;
    overview += `IMPORTANT: You MUST inform the user that this is a partial extraction.\n`;
    overview += `To access remaining pages, call get_file_text with startPage=${processedRange[1] + 1}.\n`;
  }

  return { type: 'text', text: overview };
}

function buildBookendWarning(
  processedRange: [number, number],
  totalPages: number
): ContentBlock {
  return {
    type: 'text',
    text: `⚠️ REMINDER: You only received pages ${processedRange[0]}–${processedRange[1]} of this ` +
          `${totalPages}-page document. You MUST inform the user about this limitation ` +
          `and offer to fetch the remaining pages using get_file_text with startPage=${processedRange[1] + 1}.`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point for the smart PDF extraction pipeline.
 *
 * @param buffer    Raw PDF file buffer
 * @param startPage Optional 1-indexed start page (defaults to 1)
 * @param endPage   Optional 1-indexed end page (defaults to startPage + MAX_TOTAL_PAGES - 1)
 */
export async function parsePdfSmart(
  buffer: Buffer,
  startPage?: number,
  endPage?: number
): Promise<ContentBlock[]> {
  const pdfjsLib = await getPdfjs();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  // Resolve the page range to process
  const firstPage = Math.max(1, startPage ?? 1);
  const lastPage = Math.min(
    endPage ?? (firstPage + MAX_TOTAL_PAGES - 1),
    firstPage + MAX_TOTAL_PAGES - 1,
    totalPages
  );

  const isTruncated = lastPage < totalPages;
  const processedRange: [number, number] = [firstPage, lastPage];

  // Analyze only the pages in the requested range
  const analysis = await analyzePagesRange(pdf, firstPage, lastPage);

  const blocks: ContentBlock[] = [];
  let renderedImageCount = 0;
  let skippedImageCount = 0;
  let textPageCount = 0;
  let currentPayloadSize = 0; // Estimated characters in the final MCP response

  console.error(`[PDF] ${totalPages} pages total, processing ${firstPage}–${lastPage}`);

  for (const page of analysis) {
    if (page.classification === 'text') {
      textPageCount++;
      const text = await extractPageText(pdf, page.pageNum);
      if (text) {
        const blockText = `--- Page ${page.pageNum} ---\n${text}`;
        currentPayloadSize += blockText.length;
        blocks.push({ type: 'text', text: blockText });
      }
    } else {
      // Classification is 'image' — check render and size limits
      if (renderedImageCount < MAX_IMAGE_PAGES && currentPayloadSize < MAX_PAYLOAD_BYTES) {
        const imageBuffer = await renderPageAsImage(pdf, page.pageNum, DEFAULT_DPI);
        const base64 = imageBuffer.toString('base64');
        const estSize = base64.length + 100; // +100 for JSON overhead

        if (currentPayloadSize + estSize < MAX_PAYLOAD_BYTES) {
          blocks.push({
            type: 'image',
            data: base64,
            mimeType: 'image/png'
          });
          renderedImageCount++;
          currentPayloadSize += estSize;
        } else {
          // Payload would exceed 1MB limit — fallback to text
          skippedImageCount++;
          const text = await extractPageText(pdf, page.pageNum);
          blocks.push({
            type: 'text',
            text: `--- Page ${page.pageNum} ---\n[⚠️ Size limit reached. Image skipped to prevent error. Text fallback below]\n${text || '[No extractable text]'}`
          });
        }
      } else {
        skippedImageCount++;
        const text = await extractPageText(pdf, page.pageNum);
        const reason = renderedImageCount >= MAX_IMAGE_PAGES ? 'Image render limit reached' : 'Size limit reached';
        blocks.push({
          type: 'text',
          text: `--- Page ${page.pageNum} ---\n[⚠️ ${reason}. Text fallback below]\n${text || '[No extractable text on this page]'}`
        });
      }
    }
  }

  const imagePageCount = renderedImageCount + skippedImageCount;

  // Prepend overview block (always first)
  blocks.unshift(buildOverviewBlock(
    totalPages,
    processedRange,
    textPageCount,
    renderedImageCount,
    skippedImageCount,
    isTruncated
  ));

  // Append bookend warning if truncated (always last)
  if (isTruncated) {
    blocks.push(buildBookendWarning(processedRange, totalPages));
  }

  // Debug summary for MCP console
  console.error(`[PDF] Classification: ${textPageCount} text, ${imagePageCount} image`);
  console.error(`[PDF] Rendered ${renderedImageCount}/${imagePageCount} image pages (${skippedImageCount} skipped)`);

  await pdf.destroy();
  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyzes a specific range of pages in the PDF.
 */
async function analyzePagesRange(
  pdf: PDFDocumentProxy,
  firstPage: number,
  lastPage: number
): Promise<PageAnalysis[]> {
  const pdfjsLib = await getPdfjs();
  const analysis: PageAnalysis[] = [];

  for (let i = firstPage; i <= lastPage; i++) {
    const page = await pdf.getPage(i);

    // 1. Get text content char count
    const textContent = await page.getTextContent();
    const textLength = textContent.items.reduce((acc: number, item: any) => acc + (item.str?.length || 0), 0);

    // 2. Scan operator list for image drawing commands
    const opList = await page.getOperatorList();
    let hasImages = false;

    const imageOperators = [
      pdfjsLib.OPS.paintImageXObject,       // 85
      pdfjsLib.OPS.paintInlineImageXObject, // 86
      pdfjsLib.OPS.paintImageXObjectRepeat  // 88
    ];

    for (const opCode of opList.fnArray) {
      if (imageOperators.includes(opCode)) {
        hasImages = true;
        break;
      }
    }

    // 3. Classify (Smart Heuristic)
    let classification: 'text' | 'image' = 'text';

    if (hasImages) {
      // If a page has a lot of text, we assume any images are decorative (logos/bullets)
      // and prioritize text extraction to stay under the 1MB payload limit.
      if (textLength < MIN_TEXT_FOR_SAFE_TEXT) {
        classification = 'image';
      } else {
        classification = 'text';
      }
    }

    analysis.push({ pageNum: i, textLength, hasImages, classification });
  }

  return analysis;
}

/**
 * Full-document analysis (exported for external use, e.g. testing scripts).
 * Loads its own PDF instance internally.
 */
export async function analyzePages(buffer: Buffer): Promise<PageAnalysis[]> {
  const pdfjsLib = await getPdfjs();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const result = await analyzePagesRange(pdf, 1, pdf.numPages);
  await pdf.destroy();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs readable text from a single page's content items.
 * Groups items by Y-coordinate into lines and sorts by X-coordinate.
 */
async function extractPageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();

  const lines: { [y: number]: any[] } = {};

  for (const item of textContent.items as any[]) {
    const y = Math.round((item.transform[5] || 0) / 2) * 2;
    if (!lines[y]) lines[y] = [];
    lines[y].push(item);
  }

  const sortedY = Object.keys(lines)
    .map(Number)
    .sort((a, b) => b - a);

  let reconstructedText = '';

  for (const y of sortedY) {
    const lineItems = lines[y].sort((a, b) => (a.transform[4] || 0) - (b.transform[4] || 0));
    const lineText = lineItems.map((item: any) => item.str).join(' ').trim();
    if (lineText) {
      reconstructedText += lineText + '\n';
    }
  }

  return reconstructedText
    .replace(/\s+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Image Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders a single PDF page to a PNG buffer using @napi-rs/canvas.
 */
async function renderPageAsImage(pdf: PDFDocumentProxy, pageNum: number, dpi: number = 150): Promise<Buffer> {
  const page = await pdf.getPage(pageNum);

  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });

  // Floor dimensions to avoid fractional pixel errors
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');

  await (page as any).render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;

  return Buffer.from(canvas.toBuffer('image/png'));
}
