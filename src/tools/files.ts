import { scraper, SessionExpiredError } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';
import { parsePdf } from '../parser/pdf';
import { parseDocx } from '../parser/docx';
import { parsePptx } from '../parser/pptx';
import path from 'path';
import crypto from 'crypto';

export async function getFileText(courseId: string, fileUrl: string) {
  try {
    // We use an MD5 hash of the URL to ensure a unique, safe cache key
    const urlHash = crypto.createHash('md5').update(fileUrl).digest('hex');
    const cacheKey = `file_${urlHash}`;
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

    if (!text || text.trim() === '') {
      text = `[No text could be extracted from this file. It may be a scanned document or unsupported format.]`;
    }

    if (!text.startsWith('[Error') && !text.startsWith('[No text')) {
      cache.set(cacheKey, text, TTL.FILES);
    }

    return { content: [{ type: 'text' as const, text }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
