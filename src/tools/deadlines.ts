import { scraper, SessionExpiredError, Assignment } from '../scraper/eclass';
import { getAuthUrl, openAuthWindow } from '../auth/server';
import { sessionExpiredPayload } from '../errors/tool-error';
import { cache, TTL, getCacheKey, attachCacheMeta } from '../cache/store';
import { DeadlineItem, ItemDetails } from '../types/deadlines';
import {
  EclassToolJsonPayloadSchema,
  ItemDetailsMetaSchema,
} from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';

type DeadlineScope = 'upcoming' | 'month' | 'range';

function parseEClassDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const raw = dateStr.trim();

  // If it's an ISO-ish datetime, Date can parse it.
  let d = new Date(raw);
  if (!isNaN(d.getTime())) return d;

  // Moodle strings like "Tuesday, 31 March" or "31 March, 11:59 PM"
  const now = new Date();
  const currentYear = now.getFullYear();
  const match = raw.match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (match) {
    const day = match[1];
    const month = match[2];
    d = new Date(`${month} ${day}, ${currentYear}`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function isSameMonthYear(date: Date, month: number, year: number): boolean {
  return date.getMonth() + 1 === month && date.getFullYear() === year;
}

function parseBoundaryDate(raw: string, isEndBoundary: boolean): Date {
  const d = new Date(raw);
  if (isNaN(d.getTime())) throw new Error('Invalid date boundary');

  // If user passed YYYY-MM-DD, normalize to whole-day boundaries.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    if (isEndBoundary) {
      d.setHours(23, 59, 59, 999);
    } else {
      d.setHours(0, 0, 0, 0);
    }
  }
  return d;
}

export async function getUpcomingDeadlines(
  _daysAhead: number = 30,
  courseId?: string
) {
  try {
    const cacheKey = getCacheKey('deadlines', 'upcoming', courseId || 'all');
    const cached = cache.getWithMeta<Assignment[]>(cacheKey);

    if (cached) {
      const resp = attachCacheMeta(cached.data, {
        hit: true,
        fetched_at: cached.fetched_at,
        expires_at: cached.expires_at,
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
    const resp = attachCacheMeta(deadlines, {
      hit: false,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return asValidatedMcpText(
      'get_upcoming_deadlines',
      EclassToolJsonPayloadSchema,
      resp
    );
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
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

function deadlineCacheKey(
  scope: DeadlineScope,
  courseId?: string,
  extra?: string
) {
  const coursePart = courseId || 'all';
  return getCacheKey('deadlines', scope, coursePart, extra || '');
}

function hasUsableItems<T>(value: T[] | null): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

function detailsCacheKey(url: string) {
  // Use a hash or shortened URL for the key segment
  const shortened = url.length > 150 ? url.slice(-150) : url;
  return getCacheKey('details', 'v2', shortened);
}

function inferTypeFromUrl(url: string): 'assign' | 'quiz' | 'other' {
  const u = (url || '').toLowerCase();
  if (u.includes('/mod/assign/')) return 'assign';
  if (u.includes('/mod/quiz/')) return 'quiz';
  if (u.includes('assign')) return 'assign';
  if (u.includes('quiz')) return 'quiz';
  return 'other';
}

function toDeadlineItems(assignments: Assignment[]): DeadlineItem[] {
  return assignments.map((a) => ({ ...a, type: inferTypeFromUrl(a.url) }));
}

async function getDetailsWithMeta(
  url: string
): Promise<{ data: ItemDetails; meta: any }> {
  const key = detailsCacheKey(url);
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

  const details = await scraper.getItemDetails(url);
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

export async function getDeadlines(params: {
  courseId?: string;
  scope?: DeadlineScope;
  month?: number;
  year?: number;
  from?: string;
  to?: string;
  includeDetails?: boolean;
  maxDetails?: number;
}) {
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
    let items: DeadlineItem[] = [];
    let cacheMeta: any = null;

    if (scope === 'upcoming') {
      const key = deadlineCacheKey('upcoming', courseId);
      const cached = cache.getWithMeta<Assignment[]>(key);
      if (cached && hasUsableItems(cached.data)) {
        items = toDeadlineItems(cached.data);
        cacheMeta = {
          hit: true,
          fetched_at: cached.fetched_at,
          expires_at: cached.expires_at,
        };
      } else {
        const deadlines = await scraper.getDeadlines(courseId);
        cache.set(key, deadlines, TTL.DEADLINES);
        items = toDeadlineItems(deadlines);
        const now = new Date();
        cacheMeta = {
          hit: false,
          fetched_at: now.toISOString(),
          expires_at: new Date(
            now.getTime() + TTL.DEADLINES * 60000
          ).toISOString(),
        };
      }
    } else if (scope === 'month') {
      const m = month ?? new Date().getMonth() + 1;
      const y = year ?? new Date().getFullYear();
      const extra = `${y}_${m}`;
      const key = deadlineCacheKey('month', courseId, extra);
      const cached = cache.getWithMeta<DeadlineItem[]>(key);
      if (cached && hasUsableItems(cached.data)) {
        items = cached.data;
        cacheMeta = {
          hit: true,
          fetched_at: cached.fetched_at,
          expires_at: cached.expires_at,
        };
      } else {
        const allAssignments =
          await scraper.getAllAssignmentDeadlines(courseId);
        items = allAssignments.filter((it) => {
          const d = parseEClassDate(it.dueDate);
          return d ? isSameMonthYear(d, m, y) : false;
        });
        cache.set(key, items, TTL.DEADLINES);
        const now = new Date();
        cacheMeta = {
          hit: false,
          fetched_at: now.toISOString(),
          expires_at: new Date(
            now.getTime() + TTL.DEADLINES * 60000
          ).toISOString(),
        };
      }
    } else if (scope === 'range') {
      if (!from || !to) {
        throw new Error('scope=range requires both from and to');
      }
      const fromDate = parseBoundaryDate(from, false);
      const toDate = parseBoundaryDate(to, true);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('Invalid from/to date. Use ISO or YYYY-MM-DD.');
      }
      const extra = `${fromDate.toISOString().slice(0, 10)}_${toDate.toISOString().slice(0, 10)}`;
      const key = deadlineCacheKey('range', courseId, extra);
      const cached = cache.getWithMeta<DeadlineItem[]>(key);
      if (cached && hasUsableItems(cached.data)) {
        items = cached.data;
        cacheMeta = {
          hit: true,
          fetched_at: cached.fetched_at,
          expires_at: cached.expires_at,
        };
      } else {
        const allAssignments =
          await scraper.getAllAssignmentDeadlines(courseId);
        const filtered = allAssignments.filter((it) => {
          const d = parseEClassDate(it.dueDate);
          if (!d) return false;
          return d >= fromDate && d <= toDate;
        });

        // Dedup by url if possible
        const seen = new Set<string>();
        items = filtered.filter((it) => {
          const k = it.url || it.id;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        cache.set(key, items, TTL.DEADLINES);
        const now = new Date();
        cacheMeta = {
          hit: false,
          fetched_at: now.toISOString(),
          expires_at: new Date(
            now.getTime() + TTL.DEADLINES * 60000
          ).toISOString(),
        };
      }
    }

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

    const resp = attachCacheMeta(items, cacheMeta);
    return asValidatedMcpText(
      'get_deadlines',
      EclassToolJsonPayloadSchema,
      resp
    );
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return asValidatedMcpText(
        'get_deadlines',
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

export async function getItemDetails(params: {
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
}) {
  try {
    const url = params?.url;
    if (!url) throw new Error('url is required');

    const includeImages = params?.includeImages ?? false;
    const includeCsv = params?.includeCsv ?? false;
    const maxImages = params?.maxImages ?? 3;
    const imageOffset = params?.imageOffset ?? 0;
    const maxTotalImageBytes = params?.maxTotalImageBytes ?? 750_000;

    const csvMode = params?.csvMode ?? 'auto';
    const maxCsvBytes = params?.maxCsvBytes ?? 200_000;
    const csvPreviewLines = params?.csvPreviewLines ?? 200;
    const maxCsvAttachments = params?.maxCsvAttachments ?? 3;

    const { data: details, meta: cacheMeta } = await getDetailsWithMeta(url);

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
          const downloaded = await scraper.downloadFile(att.url);
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

      const downloadedImages: Array<{ base64: string; mimeType: string }> = [];
      let usedBytes = 0;
      let attemptedCount = 0;

      imagesSkippedByBudget = 0;

      for (let i = 0; i < slice.length; i++) {
        attemptedCount = i + 1;
        if (downloadedImages.length >= maxImages) break;

        const imageUrl = slice[i];
        try {
          const { buffer, mimeType } = await scraper.downloadFile(imageUrl);
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
      // Attach images after metadata JSON and CSV blocks.
      const allImageUrls = details.descriptionImageUrls ?? [];
      const offset = Math.max(0, imageOffset);
      const slice = allImageUrls.slice(offset);

      const downloadedImages: Array<{ base64: string; mimeType: string }> = [];
      let usedBytes = 0;
      for (let i = 0; i < slice.length; i++) {
        if (downloadedImages.length >= maxImages) break;
        const imageUrl = slice[i];
        try {
          const { buffer, mimeType } = await scraper.downloadFile(imageUrl);
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
            continue;
          }
          const base64 = buffer.toString('base64');
          const estBytes = base64.length;
          if (usedBytes + estBytes > maxTotalImageBytes) {
            break;
          }
          downloadedImages.push({ base64, mimeType });
          usedBytes += estBytes;
        } catch {
          // skip failed image download
        }
      }

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
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return asValidatedMcpText(
        'get_item_details',
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
