const pdf = require('pdf-parse');

export async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdf(buffer);
    let text = data.text;
    
    // Trim whitespace, collapse multiple newlines into max 2
    text = text.replace(/\s+$/gm, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    
    return text;
  } catch (error) {
    console.error('Error parsing PDF:', error);
    return '';
  }
}
