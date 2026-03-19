import * as pdfjsLib from 'pdfjs-dist';

export interface PageAnalysis {
  pageNum: number;       // 1-indexed
  textLength: number;    // Character count from getTextContent()
  hasImages: boolean;     // True if paintImageXObject or similar is found
  classification: 'text' | 'image';
}

const MIN_TEXT_CHARS = 50;  // Threshold to classify as "text-heavy" if no images

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

  // Cleanup: specifically for older pdfjsLib if needed, most modern ones handle GC well.
  await pdf.destroy();

  return analysis;
}
