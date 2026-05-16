import { scraper, SessionExpiredError, Assignment } from '../scraper/eclass';
import { getAuthUrl } from '../auth/server';
import { sessionExpiredPayload, toErrorPayload } from '../errors/tool-error';
import { ValidationError } from '../errors/validation-error';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { ItemDetails } from '../types/deadlines';
import {
  EclassToolErrorResponseSchema,
  EclassToolJsonPayloadSchema,
  ItemDetailsMetaSchema,
} from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import {
  handleEclassSessionExpired,
  isSessionStorageUnavailable,
  sessionStorageUnavailableResponse,
} from './auth-retry';
import { getEclassDeadlineItems, type DeadlineScope } from './eclass-service';
import {
  isScrapeLayoutChanged,
  scrapeLayoutChangedResponse,
} from './scrape-layout-response';
import { validateUrlForPolicy } from '../security/url-policy';

function attachEclassDeadlinePayload(
  items: unknown[],
  cacheMeta: any,
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
  authRetryAttempted: boolean = false
): Promise<any> {
  try {
    const cacheKey = getCacheKey('deadlines', 'upcoming', courseId || 'all');
    const cached = cache.getWithMeta<Assignment[]>(cacheKey);

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

    const deadlines = await scraper.getDeadlines(courseId);
    cache.set(cacheKey, deadlines, TTL.DEADLINES);

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
  } catch (e) {
    if (isSessionStorageUnavailable(e)) {
      return sessionStorageUnavailableResponse('get_upcoming_deadlines');
    }
    if (isScrapeLayoutChanged(e)) {
      return scrapeLayoutChangedResponse('get_upcoming_deadlines', e);
    }
    if (e instanceof SessionExpiredError) {
      const fallback = (error: SessionExpiredError) =>
        asValidatedMcpText(
          'get_upcoming_deadlines',
          EclassToolJsonPayloadSchema,
          sessionExpiredPayload(error.message, {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          })
        );
      if (!authRetryAttempted) {
        return handleEclassSessionExpired(
          e,
          () => getUpcomingDeadlines(_daysAhead, courseId, true),
          fallback
        );
      }
      return asValidatedMcpText(
        'get_upcoming_deadlines',
        EclassToolJsonPayloadSchema,
        sessionExpiredPayload(e.message, {
          afterAuth: true,
          authUrl: getAuthUrl('eclass'),
        })
      );
    }
    throw e;
  }
}

function detailsCacheKey(url: string) {
  // Use a hash or shortened URL for the key segment
  const shortened = url.length > 150 ? url.slice(-150) : url;
  return getCacheKey('details', 'v2', shortened);
}

async function getDetailsWithMeta(
  url: string
): Promise<{ data: ItemDetails; meta: any }> {
  const safeUrl = validateUrlForPolicy(url, 'eclass_item');
  const key = detailsCacheKey(safeUrl);
  const cached = cache.getWithMeta<ItemDetails>(key);

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

  const details = await scraper.getItemDetails(safeUrl);
  cache.set(key, details, TTL.DETAILS);

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
  authRetryAttempted: boolean = false
): Promise<any> {
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

  try {
    const deadlineResult = await getEclassDeadlineItems({
      courseId,
      scope,
      month,
      year,
      from,
      to,
    });
    let items = deadlineResult.items;
    const { cacheMeta } = deadlineResult;

    if (includeDetails && items.length) {
      const n = Math.max(0, Math.min(items.length, maxDetails));
      const withDetails = await Promise.all(
        items.slice(0, n).map(async (it) => {
          try {
            const { data } = await getDetailsWithMeta(it.url);
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
  } catch (e) {
    if (isSessionStorageUnavailable(e)) {
      return sessionStorageUnavailableResponse('get_deadlines');
    }
    if (isScrapeLayoutChanged(e)) {
      return scrapeLayoutChangedResponse('get_deadlines', e);
    }
    if (e instanceof SessionExpiredError) {
      const fallback = (error: SessionExpiredError) =>
        asValidatedMcpText(
          'get_deadlines',
          EclassToolJsonPayloadSchema,
          sessionExpiredPayload(error.message, {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          })
        );
      if (!authRetryAttempted) {
        return handleEclassSessionExpired(
          e,
          () => getDeadlines(params, true),
          fallback
        );
      }
      return fallback(e);
    }
    if (e instanceof ValidationError) {
      return asValidatedMcpText(
        'get_deadlines',
        EclassToolErrorResponseSchema,
        toErrorPayload('VALIDATION_FAILED', e.message, {
          ...(e.details ? { details: e.details } : {}),
        })
      );
    }
    throw e;
  }
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
  authRetryAttempted: boolean = false
): Promise<any> {
  try {
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
    const { data: details, meta: cacheMeta } =
      await getDetailsWithMeta(safeUrl);

    // Backwards compatible mode: return only the JSON payload + cache meta
    if (!includeImages && !includeCsv) {
      const resp = attachCacheMeta(details, cacheMeta);
      return asValidatedMcpText(
        'get_item_details',
        EclassToolJsonPayloadSchema,
        resp
      );
    }

    const content: any[] = [];
    const meta: any = attachCacheMeta({ ...details }, cacheMeta);

    // --- CSV inlining (optional) ---
    let csvAttachments = Array.isArray(details.attachments)
      ? details.attachments
      : [];
    csvAttachments = csvAttachments.filter((a: any) => a?.kind === 'csv');

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
          const downloaded = await scraper.downloadFile(safeAttachmentUrl);
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
    let imageTotalCount = 0;
    let imagesReturnedCount = 0;
    let imagesSkippedByBudget = 0;
    let imagesRemainingCount = 0;
    let nextImageOffset = 0;
    let usedBase64BytesEstimate = 0;
    const downloadedImages: Array<{ base64: string; mimeType: string }> = [];

    if (includeImages) {
      const allImageUrls = details.descriptionImageUrls ?? [];
      imageTotalCount = allImageUrls.length;

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

      imagesSkippedByBudget = 0;

      for (let i = 0; i < slice.length; i++) {
        attemptedCount = i + 1;
        if (downloadedImages.length >= maxImages) break;

        const imageUrl = slice[i];
        try {
          const safeImageUrl = validateUrlForPolicy(
            imageUrl,
            'eclass_attachment'
          );
          const { buffer, mimeType } = await scraper.downloadFile(safeImageUrl);
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

      imagesReturnedCount = downloadedImages.length;
      nextImageOffset = offset + attemptedCount;
      imagesRemainingCount = Math.max(0, imageTotalCount - nextImageOffset);
      usedBase64BytesEstimate = usedBytes;

      meta.imageTotalCount = imageTotalCount;
      meta.imageOffset = offset;
      meta.imagesReturnedCount = imagesReturnedCount;
      meta.imagesSkippedByBudget = imagesSkippedByBudget;
      meta.imagesRemainingCount = imagesRemainingCount;
      meta.nextImageOffset = nextImageOffset;
      meta.maxImages = maxImages;
      meta.maxTotalImageBytes = maxTotalImageBytes;
      meta.usedBase64BytesEstimate = usedBase64BytesEstimate;
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
  } catch (e) {
    if (isSessionStorageUnavailable(e)) {
      return sessionStorageUnavailableResponse('get_item_details');
    }
    if (isScrapeLayoutChanged(e)) {
      return scrapeLayoutChangedResponse('get_item_details', e);
    }
    if (e instanceof SessionExpiredError) {
      const fallback = (error: SessionExpiredError) =>
        asValidatedMcpText(
          'get_item_details',
          EclassToolJsonPayloadSchema,
          sessionExpiredPayload(error.message, {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          })
        );
      if (!authRetryAttempted) {
        return handleEclassSessionExpired(
          e,
          () => getItemDetails(params, true),
          fallback
        );
      }
      return fallback(e);
    }
    if (e instanceof ValidationError) {
      return asValidatedMcpText(
        'get_item_details',
        EclassToolErrorResponseSchema,
        toErrorPayload('VALIDATION_FAILED', e.message, {
          ...(e.details ? { details: e.details } : {}),
        })
      );
    }
    throw e;
  }
}
