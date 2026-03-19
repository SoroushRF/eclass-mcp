import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { createCanvas } from 'canvas';

export interface ContentBlock {
  type: 'text' | 'image';
  text?: string;
  data?: string;      // base64 PNG for image
  mimeType?: string;  // image/png
}

export interface PageAnalysis {
  pageNum: number;       // 1-indexed
  textLength: number;    // Character count from getTextContent()
  hasImages: boolean;     // True if paintImageXObject or similar is found
  classification: 'text' | 'image';
}

const MIN_TEXT_CHARS = 50;  // Threshold to classify as "text-heavy" if no images

/**
 * Reconstructs readable text from a single page's content items.
 * Groups items by Y-coordinate into lines and sorts by X-coordinate.
 */
async function extractPageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  
  // Group text items by their Y-coordinate (transform[5])
  const lines: { [y: number]: any[] } = {};
  
  for (const item of textContent.items as any[]) {
    // Round Y-coordinate to group items on roughly the same line (2-unit fuzz factor)
    const y = Math.round((item.transform[5] || 0) / 2) * 2;
    if (!lines[y]) lines[y] = [];
    lines[y].push(item);
  }

  // Sort Y-coordinates from top to bottom (descending Y in PDF coordinates)
  const sortedY = Object.keys(lines)
    .map(Number)
    .sort((a, b) => b - a);

  let reconstructedText = '';

  for (const y of sortedY) {
    // Sort items on the same line by X-coordinate (transform[4])
    const lineItems = lines[y].sort((a, b) => (a.transform[4] || 0) - (b.transform[4] || 0));
    const lineText = lineItems.map(item => item.str).join(' ').trim();
    if (lineText) {
      reconstructedText += lineText + '\n';
    }
  }

  // Final normalization: collapse whitespace and consecutive newlines
  return reconstructedText
    .replace(/\s+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Metadata-first analysis of the PDF structure.
 * Scans each page's operator list for images and contents for text counts.
 * This is very fast as it avoids any image rendering.
 */
export async function analyzePages(buffer: Buffer): Promise<PageAnalysis[]> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    stopAtErrors: true,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const analysis: PageAnalysis[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    
    // 1. Get text content char count
    const textContent = await page.getTextContent();
    const textLength = textContent.items.reduce((acc: number, item: any) => acc + (item.str?.length || 0), 0);

    // 2. Scan operator list for image drawing commands
    const opList = await page.getOperatorList();
    let hasImages = false;

    // These codes identify bitmap/image drawing in PDF.js
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

    // 3. Classify (mixed content with images always goes to image classification for safety)
    let classification: 'text' | 'image' = 'text';

    if (hasImages) {
      // Any page with images gets the 'image' treatment (vision reading)
      classification = 'image';
    } else if (textLength < MIN_TEXT_CHARS) {
      // Pages with no images and very little text are likely separator pages
      // but we'll stick to text classification to save tokens by default
      classification = 'text';
    }

    analysis.push({
      pageNum: i,
      textLength,
      hasImages,
      classification
    });
  }

  await pdf.destroy();
  return analysis;
}

/**
 * Renders a single PDF page to a PNG buffer using node-canvas.
 * DPI 150 is the sweet spot for readability vs token cost.
 */
async function renderPageAsImage(pdf: PDFDocumentProxy, pageNum: number, dpi: number = 150): Promise<Buffer> {
  const page = await pdf.getPage(pageNum);
  
  // Calculate viewport at the target DPI (PDF units are 72 DPI)
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });

  // Create canvas for the page
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');

  // Render the page into the canvas context
  await (page as any).render({
    canvasContext: ctx,
    viewport: viewport
  }).promise;

  return canvas.toBuffer('image/png');
}
