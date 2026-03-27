import { scraper, SessionExpiredError } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { parsePdfSmart, ContentBlock } from '../parser/pdf-analyzer';
import { parseDocx } from '../parser/docx';
import { parsePptx } from '../parser/pptx';
import path from 'path';

export async function getFileText(
  courseId: string,
  fileUrl: string,
  startPage?: number,
  endPage?: number
) {
  try {
    // Build a cache key
    let cacheKey = getCacheKey('file', fileUrl);
    if (startPage || endPage) {
      cacheKey = getCacheKey('file', fileUrl, `p${startPage ?? 1}-${endPage ?? 'end'}`);
    }

    const cached = cache.getWithMeta<any>(cacheKey);
    if (cached) {
      const { data, fetched_at, expires_at } = cached;
      const meta = { hit: true, fetched_at, expires_at };
      
      if (typeof data === 'string') {
        const resp = attachCacheMeta([{ type: 'text' as const, text: data }], meta);
        return { content: resp };
      }
      if (Array.isArray(data)) {
        const resp = attachCacheMeta(data as ContentBlock[], meta);
        return { content: resp };
      }
    }

    const { buffer, mimeType, filename } = await scraper.downloadFile(fileUrl);

    const ext = path.extname(filename).toLowerCase();
    let blocks: ContentBlock[] = [];

    if (mimeType.includes('pdf') || ext === '.pdf') {
      blocks = await parsePdfSmart(buffer, startPage, endPage);
    } else {
      let text = '';
      if (
        mimeType.includes('officedocument.wordprocessingml') ||
        ext === '.docx'
      ) {
        text = await parseDocx(buffer);
      } else if (
        mimeType.includes('officedocument.presentationml') ||
        ext === '.pptx'
      ) {
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

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.FILES * 60000);
    const resp = attachCacheMeta(blocks, {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return { content: resp };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
