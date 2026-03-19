import { scraper, SessionExpiredError } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';
import { parsePdfSmart, ContentBlock } from '../parser/pdf-analyzer';
import { parseDocx } from '../parser/docx';
import { parsePptx } from '../parser/pptx';
import path from 'path';
import crypto from 'crypto';

export async function getFileText(courseId: string, fileUrl: string) {
  try {
    // We use an MD5 hash of the URL to ensure a unique, safe cache key
    const urlHash = crypto.createHash('md5').update(fileUrl).digest('hex');
    const cacheKey = `file_${urlHash}`;
    
    // Task 6 will update caching to support mixed blocks. 
    // For now, we only use cache for non-PDF (string-only) text.
    const cached = cache.get<any>(cacheKey);
    if (cached && typeof cached === 'string') {
      return { content: [{ type: 'text' as const, text: cached }] };
    }
    
    const { buffer, mimeType, filename } = await scraper.downloadFile(fileUrl);
    
    const ext = path.extname(filename).toLowerCase();
    let blocks: ContentBlock[] = [];

    if (mimeType.includes('pdf') || ext === '.pdf') {
      blocks = await parsePdfSmart(buffer);
    } else {
      let text = '';
      if (mimeType.includes('officedocument.wordprocessingml') || ext === '.docx') {
        text = await parseDocx(buffer);
      } else if (mimeType.includes('officedocument.presentationml') || ext === '.pptx') {
        text = await parsePptx(buffer);
      } else {
        text = `Unsupported file type: ${mimeType} (${filename})`;
      }

      if (!text || text.trim() === '') {
        text = `[No text could be extracted from this file. It may be a scanned document or unsupported format.]`;
      }
      
      blocks = [{ type: 'text', text }];

      // Cache non-PDF results as strings for now
      if (!text.startsWith('[Error') && !text.startsWith('[No text')) {
        cache.set(cacheKey, text, TTL.FILES);
      }
    }

    return { content: blocks };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
