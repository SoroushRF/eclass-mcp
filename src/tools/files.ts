import {
  scraper,
  ScrapeLayoutError,
  SessionExpiredError,
} from '../scraper/eclass';
import { getAuthUrl, openAuthWindow } from '../auth/server';
import { sessionExpiredPayload, toErrorPayload } from '../errors/tool-error';
import { cache, TTL, getCacheKey } from '../cache/store';
import {
  EclassAuthRequiredSchema,
  EclassToolErrorResponseSchema,
  GetFileTextMcpResultSchema,
} from './eclass-contracts';
import {
  asValidatedMcpResult,
  asValidatedMcpText,
} from './mcp-validated-response';
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
      cacheKey = getCacheKey(
        'file',
        fileUrl,
        `p${startPage ?? 1}-${endPage ?? 'end'}`
      );
    }

    const cached = cache.getWithMeta<any>(cacheKey);
    if (cached) {
      const { data } = cached;
      const stale = 'stale' in cached && cached.stale === true;
      const staleHint: ContentBlock[] = stale
        ? [
            {
              type: 'text',
              text: '[Pinned cache past TTL — content may be stale. Use cache_refresh_pin to refresh.]',
            },
          ]
        : [];

      if (typeof data === 'string') {
        return asValidatedMcpResult(
          'get_file_text',
          GetFileTextMcpResultSchema,
          {
            content: [...staleHint, { type: 'text' as const, text: data }],
          }
        );
      }
      if (Array.isArray(data)) {
        return asValidatedMcpResult(
          'get_file_text',
          GetFileTextMcpResultSchema,
          {
            content: [...staleHint, ...(data as ContentBlock[])],
          }
        );
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

    return asValidatedMcpResult('get_file_text', GetFileTextMcpResultSchema, {
      content: blocks,
    });
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return asValidatedMcpText(
        'get_file_text',
        EclassAuthRequiredSchema,
        sessionExpiredPayload(e.message, {
          afterAuth: true,
          authUrl: getAuthUrl('eclass'),
        })
      );
    }
    if (e instanceof ScrapeLayoutError) {
      return asValidatedMcpText(
        'get_file_text',
        EclassToolErrorResponseSchema,
        toErrorPayload('SCRAPE_LAYOUT_CHANGED', e.message, {
          details: e.context,
        })
      );
    }
    throw e;
  }
}
