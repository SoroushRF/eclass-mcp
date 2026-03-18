import { scraper, SessionExpiredError } from '../scraper/eclass';
import { cache, TTL } from '../cache/store';
import { parsePdf } from '../parser/pdf';
import { parseDocx } from '../parser/docx';
import { parsePptx } from '../parser/pptx';
import path from 'path';

export async function getFileText(courseId: string, fileUrl: string) {
  try {
    // We use a normalized version of the URL as a cache key
    const cacheKey = `file_${Buffer.from(fileUrl).toString('base64').substring(0, 50)}`;
    const cached = cache.get<string>(cacheKey);
    if (cached) return { content: [{ type: 'text', text: cached }] };
    
    const { buffer, mimeType, filename } = await scraper.downloadFile(fileUrl);
    
    let text = '';
    const ext = path.extname(filename).toLowerCase();

    if (mimeType.includes('pdf') || ext === '.pdf') {
      text = await parsePdf(buffer);
    } else if (mimeType.includes('officedocument.wordprocessingml') || ext === '.docx') {
      text = await parseDocx(buffer);
    } else if (mimeType.includes('officedocument.presentationml') || ext === '.pptx') {
      text = await parsePptx(buffer);
    } else {
      text = `Unsupported file type: ${mimeType} (${filename})`;
    }

    if (text) {
      cache.set(cacheKey, text, TTL.FILES);
    }

    return { content: [{ type: 'text' as const, text }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
