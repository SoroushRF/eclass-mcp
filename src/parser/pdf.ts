const { PDFParse } = require('pdf-parse');

export async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse(new Uint8Array(buffer));
    const data = await parser.getText();
    let text = data.text;

    // Trim whitespace, collapse multiple newlines into max 2
    text = text
      .replace(/\s+$/gm, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  } catch (error: any) {
    console.error('Error parsing PDF:', error);
    return `[Error extracting text from PDF: ${error.message}]`;
  }
}
