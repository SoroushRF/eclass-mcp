import mammoth from 'mammoth';

export async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    let text = result.value;
    
    // Trim whitespace, collapse multiple newlines into max 2
    text = text.replace(/\s+$/gm, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    
    return text;
  } catch (error) {
    console.error('Error parsing DOCX:', error);
    return '';
  }
}
