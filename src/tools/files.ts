import { scraper, SessionExpiredError } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';
import { parsePdfSmart, ContentBlock } from '../parser/pdf-analyzer';
import { parseDocx } from '../parser/docx';
import { parsePptx } from '../parser/pptx';
import path from 'path';
import crypto from 'crypto';

export async function getFileText(
  courseId: string,
  fileUrl: string,
  startPage?: number,
  endPage?: number
) {
  try {
    // Build a cache key — include page range and logic version to avoid collisions
    const urlHash = crypto.createHash('md5').update(fileUrl).digest('hex');
    let cacheKey = `file_${urlHash}_v2`; // Added v2 to force refresh with new DPI limit
    if (startPage || endPage) {
      cacheKey += `_p${startPage ?? 1}-${endPage ?? 'end'}`;
    }

    // Cache lookup: handle both old string-only cache and new block-based cache
    const cached = cache.get<any>(cacheKey);
    if (cached) {
      if (typeof cached === 'string') {
        // Migration: wrap old string cache into a block
        return { content: [{ type: 'text' as const, text: cached }] };
      }
      if (Array.isArray(cached)) {
        // New block array format
        return { content: cached as ContentBlock[] };
      }
    }
    
    const { buffer, mimeType, filename } = await scraper.downloadFile(fileUrl);
    
    const ext = path.extname(filename).toLowerCase();
    let blocks: ContentBlock[] = [];

    if (mimeType.includes('pdf') || ext === '.pdf') {
      blocks = await parsePdfSmart(buffer, startPage, endPage);
    } else {
      let text = '';
      if (mimeType.includes('officedocument.wordprocessingml') || ext === '.docx') {
        text = await parseDocx(buffer);
      } else if (mimeType.includes('officedocument.presentationml') || ext === '.pptx') {
        text = await parsePptx(buffer);
      } else {
        text = `Unsupported file type: ${mimeType} (${filename})`;
      }

      const isEmpty = !text || text.trim() === '';
      if (isEmpty) {
        text = `[No text could be extracted from this file. It may be a scanned document or unsupported format.]`;
      }
      
      blocks = [{ type: 'text', text }];
    }

    // Cache the full block array (including base64 images)
    if (blocks.length > 0) {
      cache.set(cacheKey, blocks, TTL.FILES);
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
