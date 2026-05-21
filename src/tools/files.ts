import { cache, TTL, getCacheKey } from '../cache/store';
import {
  EclassAuthRequiredSchema,
  GetFileTextMcpResultSchema,
} from './eclass-contracts';
import { asValidatedMcpResult } from './mcp-validated-response';
import { parsePdfSmart, ContentBlock } from '../parser/pdf-analyzer';
import { parseDocx } from '../parser/docx';
import { parsePptx } from '../parser/pptx';
import path from 'path';
import { runEclassToolBoundary, sessionExpiredResponse } from './tool-boundary';
import { validateUrlForPolicy } from '../security/url-policy';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

export async function getFileText(
  courseId: string,
  fileUrl: string,
  startPage?: number,
  endPage?: number,
  deps: ToolDependencies = createDefaultToolDependencies()
) {
  const run = async () => {
    const safeFileUrl = validateUrlForPolicy(fileUrl, 'eclass_file');
    // Build a cache key
    let cacheKey = getCacheKey('file', safeFileUrl);
    if (startPage || endPage) {
      cacheKey = getCacheKey(
        'file',
        safeFileUrl,
        `p${startPage ?? 1}-${endPage ?? 'end'}`
      );
    }

    const cached = cache.getWithMeta<string | ContentBlock[]>(cacheKey);
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
            content: [...staleHint, ...data],
          }
        );
      }
    }

    const { buffer, mimeType, filename } =
      await deps.eclassScraper.downloadFile(safeFileUrl);

    const ext = path.extname(filename).toLowerCase();
    let blocks: ContentBlock[];

    if (mimeType.includes('pdf') || ext === '.pdf') {
      blocks = await parsePdfSmart(buffer, startPage, endPage);
    } else {
      let text: string;
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
  };

  return runEclassToolBoundary({
    toolName: 'get_file_text',
    run,
    onSessionExpired: {
      retry: run,
      fallback: (error) =>
        sessionExpiredResponse(
          'get_file_text',
          EclassAuthRequiredSchema,
          error
        ),
    },
  });
}
