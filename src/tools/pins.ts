import fs from 'fs';
import {
  buildContentCacheKey,
  buildFileCacheKey,
  buildSectionTextCacheKey,
  canonicalResourceKey,
  checkPinQuota,
  computePinId,
  getAllPins,
  getPinById,
  getPinnedBytes,
  getQuotaLimitBytes,
  removePin,
  removePinsByFilter,
  upsertPin,
  type PinRecord,
  type PinResourceType,
} from '../cache/pins';
import { getCacheFilePathForKey } from '../cache/store';
import { SessionExpiredError } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { getCourseContent, getSectionText } from './content';
import { getFileText } from './files';
import { PinToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';

function pinToolJson(toolName: string, obj: unknown) {
  return asValidatedMcpText(toolName, PinToolJsonPayloadSchema, obj);
}

function parseFileResourceKey(resource_key: string): {
  fileUrl: string;
  startPage?: number;
  endPage?: number;
} {
  const idx = resource_key.indexOf('|p');
  if (idx === -1) return { fileUrl: resource_key };
  const fileUrl = resource_key.slice(0, idx);
  const rest = resource_key.slice(idx + 2);
  const m = rest.match(/^(\d+)-(end|\d+)$/);
  if (!m) return { fileUrl };
  const startPage = parseInt(m[1], 10);
  const endPart = m[2];
  const endPage = endPart === 'end' ? undefined : parseInt(endPart, 10);
  return { fileUrl, startPage, endPage };
}

export async function cachePin(args: {
  resource_type: PinResourceType;
  fileUrl?: string;
  startPage?: number;
  endPage?: number;
  url?: string;
  courseId?: string;
  note?: string;
}) {
  try {
    const { resource_type, note } = args;
    const resource_key = canonicalResourceKey(resource_type, args);

    let cacheKey: string;
    if (resource_type === 'file') {
      if (!args.fileUrl) {
        return pinToolJson('cache_pin', {
          ok: false,
          reason: 'invalid_args',
          message: 'fileUrl is required for resource_type=file',
        });
      }
      cacheKey = buildFileCacheKey(args.fileUrl, args.startPage, args.endPage);
    } else if (resource_type === 'sectiontext') {
      if (!args.url) {
        return pinToolJson('cache_pin', {
          ok: false,
          reason: 'invalid_args',
          message: 'url is required for resource_type=sectiontext',
        });
      }
      cacheKey = buildSectionTextCacheKey(args.url);
    } else {
      if (!args.courseId) {
        return pinToolJson('cache_pin', {
          ok: false,
          reason: 'invalid_args',
          message: 'courseId is required for resource_type=content',
        });
      }
      cacheKey = buildContentCacheKey(args.courseId);
    }

    const pinId = computePinId(resource_type, resource_key);
    const fp = getCacheFilePathForKey(cacheKey);
    if (!fs.existsSync(fp)) {
      return pinToolJson('cache_pin', {
        ok: false,
        reason: 'not_cached',
        cacheKey,
        hint: 'Fetch the resource first with get_file_text, get_section_text, or get_course_content, or use cache_refresh_pin after fixing session.',
      });
    }

    const quota = checkPinQuota(cacheKey, pinId);
    if (!quota.ok) {
      return pinToolJson('cache_pin', {
        ok: false,
        reason: quota.reason,
        used_bytes: quota.used_bytes,
        would_use_bytes: quota.would_use_bytes,
        limit_bytes: quota.limit_bytes,
      });
    }

    const record: PinRecord = {
      pinId,
      resource_type,
      resource_key,
      cacheKey,
      pinned_at: new Date().toISOString(),
      ...(note ? { note } : {}),
    };
    upsertPin(record);

    return pinToolJson('cache_pin', {
      ok: true,
      pinId,
      resource_type,
      resource_key,
      cacheKey,
      quota: {
        used_bytes: getPinnedBytes(),
        limit_bytes: getQuotaLimitBytes(),
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return pinToolJson('cache_pin', { ok: false, reason: 'error', message });
  }
}

export async function cacheUnpin(args: { pinId: string }) {
  try {
    const removed = removePin(args.pinId);
    if (!removed) {
      return pinToolJson('cache_unpin', {
        ok: false,
        reason: 'not_found',
        pinId: args.pinId,
      });
    }
    return pinToolJson('cache_unpin', {
      ok: true,
      removed: true,
      pinId: args.pinId,
      message:
        'Pin removed from registry. The cache file was not deleted; use cache_delete_pinned to remove stored bytes.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return pinToolJson('cache_unpin', { ok: false, reason: 'error', message });
  }
}

export async function cacheListPins(args: { resource_type?: PinResourceType }) {
  try {
    let pins = getAllPins();
    if (args.resource_type) {
      pins = pins.filter((p) => p.resource_type === args.resource_type);
    }
    const limit = getQuotaLimitBytes();
    const used = getPinnedBytes();
    const rows = pins.map((p) => {
      const fp = getCacheFilePathForKey(p.cacheKey);
      let size_bytes = 0;
      try {
        if (fs.existsSync(fp)) size_bytes = fs.statSync(fp).size;
      } catch {
        // ignore
      }
      return {
        pinId: p.pinId,
        resource_type: p.resource_type,
        resource_key: p.resource_key,
        cacheKey: p.cacheKey,
        pinned_at: p.pinned_at,
        note: p.note,
        size_bytes,
      };
    });
    return pinToolJson('cache_list_pins', {
      ok: true,
      pins: rows,
      quota: { used_bytes: used, limit_bytes: limit },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return pinToolJson('cache_list_pins', {
      ok: false,
      reason: 'error',
      message,
    });
  }
}

export async function cacheRefreshPin(args: { pinId: string }) {
  try {
    const pin = getPinById(args.pinId);
    if (!pin) {
      return pinToolJson('cache_refresh_pin', {
        ok: false,
        reason: 'not_found',
        pinId: args.pinId,
      });
    }

    if (pin.resource_type === 'file') {
      const { fileUrl, startPage, endPage } = parseFileResourceKey(
        pin.resource_key
      );
      await getFileText('unknown', fileUrl, startPage, endPage);
    } else if (pin.resource_type === 'sectiontext') {
      await getSectionText(pin.resource_key);
    } else {
      await getCourseContent(pin.resource_key);
    }

    const now = new Date().toISOString();
    return pinToolJson('cache_refresh_pin', {
      ok: true,
      pinId: pin.pinId,
      refreshed: true,
      cache: {
        message: 'Underlying tool refreshed; TTL reset for this cache key.',
        refreshed_at: now,
      },
    });
  } catch (e: unknown) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return pinToolJson('cache_refresh_pin', {
        ok: false,
        reason: 'session_expired',
        message: e.message,
      });
    }
    const message = e instanceof Error ? e.message : String(e);
    return pinToolJson('cache_refresh_pin', {
      ok: false,
      reason: 'error',
      message,
    });
  }
}

export async function cacheDeletePinned(args: {
  pinId?: string;
  mode?: 'all' | 'by_type';
  resource_type?: PinResourceType;
}) {
  try {
    let removedPins = 0;
    let removedCacheFiles = 0;

    if (args.pinId) {
      const pin = getPinById(args.pinId);
      if (!pin) {
        return pinToolJson('cache_delete_pinned', {
          ok: false,
          reason: 'not_found',
          pinId: args.pinId,
        });
      }
      const fp = getCacheFilePathForKey(pin.cacheKey);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        removedCacheFiles++;
      }
      removePin(args.pinId);
      removedPins++;
      return pinToolJson('cache_delete_pinned', {
        ok: true,
        removed_pins: removedPins,
        removed_cache_files: removedCacheFiles,
      });
    }

    const mode = args.mode ?? 'all';
    if (mode === 'all') {
      const pins = getAllPins();
      for (const p of pins) {
        const fp = getCacheFilePathForKey(p.cacheKey);
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          removedCacheFiles++;
        }
      }
      removedPins = removePinsByFilter(() => true).length;
      return pinToolJson('cache_delete_pinned', {
        ok: true,
        removed_pins: removedPins,
        removed_cache_files: removedCacheFiles,
      });
    }

    if (mode === 'by_type' && args.resource_type) {
      const rt = args.resource_type;
      const removed = removePinsByFilter((p) => p.resource_type === rt);
      for (const p of removed) {
        const fp = getCacheFilePathForKey(p.cacheKey);
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          removedCacheFiles++;
        }
      }
      removedPins = removed.length;
      return pinToolJson('cache_delete_pinned', {
        ok: true,
        removed_pins: removedPins,
        removed_cache_files: removedCacheFiles,
        resource_type: rt,
      });
    }

    return pinToolJson('cache_delete_pinned', {
      ok: false,
      reason: 'invalid_args',
      message:
        'Provide pinId, or mode=all, or mode=by_type with resource_type.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return pinToolJson('cache_delete_pinned', {
      ok: false,
      reason: 'error',
      message,
    });
  }
}
