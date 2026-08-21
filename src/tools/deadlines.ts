import type { Assignment } from '../scraper/eclass';
import { ValidationError } from '../errors/validation-error';
import {
  cache,
  TTL,
  attachCacheMeta,
  type CacheMetadata,
} from '../cache/store';
import { tryGetEclassCacheKey } from '../cache/account-scope';
import { ItemDetails } from '../types/deadlines';
import type { Attachment } from '../types/deadlines';
import {
  EclassToolJsonPayloadSchema,
  ItemDetailsMetaSchema,
} from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import {
  runEclassToolBoundary,
  sessionExpiredResponse,
  type McpTextResponse,
} from './tool-boundary';
import { getEclassDeadlineItems, type DeadlineScope } from './eclass-service';
import { validateUrlForPolicy } from '../security/url-policy';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

type ItemDetailsContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; text?: undefined };

type ItemDetailsToolResult = {
  content: ItemDetailsContentBlock[];
  isError?: boolean;
};

function attachEclassDeadlinePayload(
  items: unknown[],
  cacheMeta: CacheMetadata,
  context: {
    scope: string;
    courseId?: string;
  }
) {
  if (items.length > 0) {
    return attachCacheMeta(items, cacheMeta);
  }

  return attachCacheMeta(
    {
      items,
      status: 'no_eclass_assignments',
      scope: context.scope,
      courseId: context.courseId,
      external_check_recommended: true,
      recommendedTool: 'get_assignments',
      message:
        'No eClass assignment/quiz deadlines were found. This is not final for courses that may use Cengage/WebAssign; call get_assignments to check external platforms.',
    },
    cacheMeta
  );
}

export async function getUpcomingDeadlines(
  _daysAhead: number = 30,
  courseId?: string,
  authRetryAttempted: boolean = false,
  deps: ToolDependencies = createDefaultToolDependencies()
): Promise<McpTextResponse> {
  const run = async (): Promise<McpTextResponse> => {
    const cacheKey = tryGetEclassCacheKey(
      'deadlines',
      'upcoming',
      courseId || 'all'
    );
    const cached = cacheKey
      ? cache.getWithMeta<Assignment[]>(cacheKey)
      : null;

    if (cached) {
      const cacheMeta = {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      };
      const resp = attachEclassDeadlinePayload(cached.data, cacheMeta, {
        scope: 'upcoming',
        courseId,
      });
      return asValidatedMcpText(
        'get_upcoming_deadlines',
        EclassToolJsonPayloadSchema,
        resp
      );
    }

    const deadlines = await deps.eclassScraper.getDeadlines(courseId);
    if (cacheKey) cache.set(cacheKey, deadlines, TTL.DEADLINES);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL.DEADLINES * 60000);
    const cacheMeta = {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
    const resp = attachEclassDeadlinePayload(deadlines, cacheMeta, {
      scope: 'upcoming',
      courseId,
    });

    return asValidatedMcpText(
      'get_upcoming_deadlines',
      EclassToolJsonPayloadSchema,
      resp
    );
  };

  return runEclassToolBoundary({
    toolName: 'get_upcoming_deadlines',
    run,
    onSessionExpired: {
      attempted: authRetryAttempted,
      retry: () => getUpcomingDeadlines(_daysAhead, courseId, true, deps),
      fallback: (error) =>
        sessionExpiredResponse(
          'get_upcoming_deadlines',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}

function detailsCacheKey(url: string): string | null {
  // Use a hash or shortened URL for the key segment
  const shortened = url.length > 150 ? url.slice(-150) : url;
  return tryGetEclassCacheKey('details', 'v2', shortened);
}

async function getDetailsWithMeta(
  url: string,
  deps: ToolDependencies
): Promise<{ data: ItemDetails; meta: CacheMetadata }> {
  const safeUrl = validateUrlForPolicy(url, 'eclass_item');
  const key = detailsCacheKey(safeUrl);
  const cached = key ? cache.getWithMeta<ItemDetails>(key) : null;

  if (cached) {
    return {
      data: cached.data,
      meta: {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
      },
    };
  }

  const details = await deps.eclassScraper.getItemDetails(safeUrl);
  if (key) cache.set(key, details, TTL.DETAILS);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL.DETAILS * 60000);
  return {
    data: details,
    meta: {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
  };
}

export async function getDeadlines(
  params: {
    courseId?: string;
    scope?: DeadlineScope;
    month?: number;
    year?: number;
    from?: string;
    to?: string;
    includeDetails?: boolean;
    maxDetails?: number;
  },
  authRetryAttempted: boolean = false,
  deps: ToolDependencies = createDefaultToolDependencies()
): Promise<McpTextResponse> {
  const {
    courseId,
    scope = 'upcoming',
    month,
    year,
    from,
    to,
    includeDetails = false,
    maxDetails = 7,
  } = params || {};

  const run = async (): Promise<McpTextResponse> => {
    const deadlineResult = await getEclassDeadlineItems(
      {
        courseId,
        scope,
        month,
        year,
        from,
        to,
      },
      deps.eclassScraper
    );
    let items = deadlineResult.items;
    const { cacheMeta } = deadlineResult;

    if (includeDetails && items.length) {
      const n = Math.max(0, Math.min(items.length, maxDetails));
      const withDetails = await Promise.all(
        items.slice(0, n).map(async (it) => {
          try {
            const { data } = await getDetailsWithMeta(it.url, deps);
            return { ...it, details: data };
          } catch {
            return it;
          }
        })
      );
      items = [...withDetails, ...items.slice(n)];
    }

    const resp = attachEclassDeadlinePayload(items, cacheMeta, {
      scope,
      courseId,
    });
    return asValidatedMcpText(
      'get_deadlines',
      EclassToolJsonPayloadSchema,
      resp
    );
  };

  return runEclassToolBoundary({
    toolName: 'get_deadlines',
    run,
    onSessionExpired: {
      attempted: authRetryAttempted,
      retry: () => getDeadlines(params, true, deps),
      fallback: (error) =>
        sessionExpiredResponse(
          'get_deadlines',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}

export async function getItemDetails(
  params: {
    url: string;
    includeImages?: boolean;
    maxImages?: number;
    imageOffset?: number;
    maxTotalImageBytes?: number;
    includeCsv?: boolean;
    csvMode?: 'auto' | 'full' | 'preview';
    maxCsvBytes?: number;
    csvPreviewLines?: number;
    maxCsvAttachments?: number;
  },
  authRetryAttempted: boolean = false,
  deps: ToolDependencies = createDefaultToolDependencies()
): Promise<ItemDetailsToolResult> {
  const run = async (): Promise<ItemDetailsToolResult> => {
    const url = params?.url;
    if (!url) {
      throw new ValidationError('url is required', { field: 'url' });
    }

    const includeImages = params?.includeImages ?? false;
    const includeCsv = params?.includeCsv ?? false;
    const maxImages = params?.maxImages ?? 3;
    const imageOffset = params?.imageOffset ?? 0;
    const maxTotalImageBytes = params?.maxTotalImageBytes ?? 750_000;

    const csvMode = params?.csvMode ?? 'auto';
    const maxCsvBytes = params?.maxCsvBytes ?? 200_000;
    const csvPreviewLines = params?.csvPreviewLines ?? 200;
    const maxCsvAttachments = params?.maxCsvAttachments ?? 3;

    const safeUrl = validateUrlForPolicy(url, 'eclass_item');
    const { data: details, meta: cacheMeta } = await getDetailsWithMeta(
      safeUrl,
      deps
    );

    // Backwards compatible mode: return only the JSON payload + cache meta
    if (!includeImages && !includeCsv) {
      const resp = attachCacheMeta(details, cacheMeta);
      return asValidatedMcpText(
        'get_item_details',
        EclassToolJsonPayloadSchema,
        resp
      );
    }

    const content: ItemDetailsContentBlock[] = [];
    const meta: Record<string, unknown> & { _cache: CacheMetadata } = {
      ...details,
      _cache: cacheMeta,
    };

    // --- CSV inlining (optional) ---
    let csvAttachments: Attachment[] = Array.isArray(details.attachments)
      ? details.attachments
      : [];
    csvAttachments = csvAttachments.filter((a) => a.kind === 'csv');

    const csvIncluded: Array<{
      name?: string;
      url: string;
      mode: string;
      bytes: number;
      truncated: boolean;
    }> = [];
    let csvSkippedCount = 0;

    if (includeCsv && csvAttachments.length) {
      const limitedCsv = csvAttachments.slice(
        0,
        Math.max(0, maxCsvAttachments)
      );
      for (const att of limitedCsv) {
        try {
          const safeAttachmentUrl = validateUrlForPolicy(
            att.url,
            'eclass_attachment'
          );
          const downloaded =
            await deps.eclassScraper.downloadFile(safeAttachmentUrl);
          const bytes = downloaded.buffer.length;

          const truncatedBySize = bytes > maxCsvBytes;
          let mode = csvMode;

          if (csvMode === 'full') {
            if (truncatedBySize) {
              mode = 'preview';
            } else {
              mode = 'full';
            }
          }

          if (mode === 'auto') {
            mode = truncatedBySize ? 'preview' : 'full';
          }

          const bufferForDecode =
            mode === 'preview'
              ? downloaded.buffer.slice(
                  0,
                  Math.min(downloaded.buffer.length, maxCsvBytes)
                )
              : downloaded.buffer;

          // Decode as UTF-8 (best effort). Moodle CSVs are usually UTF-8; if not, we at least return something.
          let finalText = bufferForDecode.toString('utf-8');
          finalText = finalText.replace(/^\uFEFF/, ''); // strip UTF-8 BOM
          finalText = finalText.replace(/\u0000/g, '');

          if (mode === 'preview') {
            // Restrict to the first N lines (and implicitly to maxCsvBytes due to decode size assumption).
            const lines = finalText.split(/\r?\n/);
            finalText = lines.slice(0, csvPreviewLines).join('\n');
          }

          // Final hard cap: never inline more than maxCsvBytes characters.
          if (finalText.length > maxCsvBytes) {
            finalText = finalText.slice(0, maxCsvBytes);
            csvIncluded.push({
              name: att.name,
              url: att.url,
              mode,
              bytes,
              truncated: true,
            });
          } else {
            csvIncluded.push({
              name: att.name,
              url: att.url,
              mode,
              bytes,
              truncated: truncatedBySize,
            });
          }

          content.push({
            type: 'text' as const,
            text: `--- CSV: ${att.name || 'attachment'} ---\n${finalText}`,
          });
        } catch {
          csvSkippedCount++;
        }
      }
    }

    meta.csvTotalAttachments = csvAttachments.length;
    meta.csvIncludedCount = csvIncluded.length;
    meta.csvSkippedCount = csvSkippedCount;

    // --- Image vision inlining (optional) ---
    const downloadedImages: Array<{ base64: string; mimeType: string }> = [];

    if (includeImages) {
      const allImageUrls = details.descriptionImageUrls ?? [];
      const imageTotalCount = allImageUrls.length;

      if (!allImageUrls.length) {
        meta.imageTotalCount = 0;
        meta.imagesReturnedCount = 0;
        meta.imagesSkippedByBudget = 0;
        meta.imagesRemainingCount = 0;
        meta.nextImageOffset = 0;
        meta.note = 'No instruction images found in descriptionHtml.';

        const metaBlock = asValidatedMcpText(
          'get_item_details',
          ItemDetailsMetaSchema,
          meta
        );
        content.unshift(metaBlock.content[0]);

        return { content };
      }

      const offset = Math.max(0, imageOffset);
      const slice = allImageUrls.slice(offset);

      let usedBytes = 0;
      let attemptedCount = 0;
      let imagesSkippedByBudget = 0;

      for (let i = 0; i < slice.length; i++) {
        attemptedCount = i + 1;
        if (downloadedImages.length >= maxImages) break;

        const imageUrl = slice[i];
        try {
          const safeImageUrl = validateUrlForPolicy(
            imageUrl,
            'eclass_attachment'
          );
          const { buffer, mimeType } =
            await deps.eclassScraper.downloadFile(safeImageUrl);
          const urlLower = imageUrl.toLowerCase();
          const isImageByMime = mimeType.startsWith('image/');
          const isImageByExt =
            urlLower.endsWith('.png') ||
            urlLower.endsWith('.jpg') ||
            urlLower.endsWith('.jpeg') ||
            urlLower.endsWith('.gif') ||
            urlLower.endsWith('.webp') ||
            urlLower.includes('.png?') ||
            urlLower.includes('.jpg?') ||
            urlLower.includes('.jpeg?') ||
            urlLower.includes('.gif?') ||
            urlLower.includes('.webp?');

          if (!isImageByMime && !isImageByExt) {
            imagesSkippedByBudget++;
            continue;
          }

          const base64 = buffer.toString('base64');
          const estBytes = base64.length;
          if (usedBytes + estBytes > maxTotalImageBytes) {
            imagesSkippedByBudget++;
            break;
          }

          downloadedImages.push({ base64, mimeType });
          usedBytes += estBytes;
        } catch {
          imagesSkippedByBudget++;
        }
      }

      const imagesReturnedCount = downloadedImages.length;
      const nextImageOffset = offset + attemptedCount;
      const imagesRemainingCount = Math.max(
        0,
        imageTotalCount - nextImageOffset
      );

      meta.imageTotalCount = imageTotalCount;
      meta.imageOffset = offset;
      meta.imagesReturnedCount = imagesReturnedCount;
      meta.imagesSkippedByBudget = imagesSkippedByBudget;
      meta.imagesRemainingCount = imagesRemainingCount;
      meta.nextImageOffset = nextImageOffset;
      meta.maxImages = maxImages;
      meta.maxTotalImageBytes = maxTotalImageBytes;
      meta.usedBase64BytesEstimate = usedBytes;
    }

    if (includeImages) {
      // Attach the images downloaded during the metadata pass after text/CSV blocks.
      for (const img of downloadedImages) {
        content.push({
          type: 'image' as const,
          data: img.base64,
          mimeType: img.mimeType,
        });
      }
    }

    // First block: metadata
    const metaBlockFinal = asValidatedMcpText(
      'get_item_details',
      ItemDetailsMetaSchema,
      meta
    );
    content.unshift(metaBlockFinal.content[0]);

    return { content };
  };

  return runEclassToolBoundary({
    toolName: 'get_item_details',
    run,
    onSessionExpired: {
      attempted: authRetryAttempted,
      retry: () => getItemDetails(params, true, deps),
      fallback: (error) =>
        sessionExpiredResponse(
          'get_item_details',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}
