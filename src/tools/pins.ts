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
import {
  EclassAccountScopeUnavailableError,
  requireActiveEclassAccountScope,
} from '../cache/account-scope';
import { SessionExpiredError } from '../scraper/eclass';
import { getAuthUrl } from '../auth/server';
import { ValidationError } from '../errors/validation-error';
import { getCourseContent, getSectionText } from './content';
import { getFileText } from './files';
import { PinToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { handleEclassSessionExpired } from './auth-retry';
import { validateUrlForPolicy } from '../security/url-policy';

function pinToolJson(toolName: string, obj: unknown) {
  return asValidatedMcpText(toolName, PinToolJsonPayloadSchema, obj);
}

type PinToolResult = ReturnType<typeof pinToolJson>;

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

function getAuthRequiredMessage(result: {
  content?: Array<{ text?: string } | Record<string, unknown>>;
}): string | null {
  const firstBlock = result.content?.[0] as { text?: string } | undefined;
  const text = firstBlock?.text;
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    if (payload?.status === 'auth_required') {
      return typeof payload.message === 'string'
        ? payload.message
        : 'Session expired';
    }
  } catch {
    return null;
  }
  return null;
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
    const normalizedArgs = { ...args };

    let cacheKey: string;
    let accountScope: string | undefined;
    if (resource_type === 'file') {
      if (!args.fileUrl) {
        return pinToolJson('cache_pin', {
          ok: false,
          reason: 'invalid_args',
          message: 'fileUrl is required for resource_type=file',
        });
      }
      normalizedArgs.fileUrl = validateUrlForPolicy(
        args.fileUrl,
        'eclass_file'
      );
      accountScope = requireActiveEclassAccountScope();
      cacheKey = buildFileCacheKey(
        normalizedArgs.fileUrl,
        args.startPage,
        args.endPage,
        accountScope
      );
    } else if (resource_type === 'sectiontext') {
      if (!args.url) {
        return pinToolJson('cache_pin', {
          ok: false,
          reason: 'invalid_args',
          message: 'url is required for resource_type=sectiontext',
        });
      }
      normalizedArgs.url = validateUrlForPolicy(args.url, 'eclass_section');
      accountScope = requireActiveEclassAccountScope();
      cacheKey = buildSectionTextCacheKey(normalizedArgs.url, accountScope);
    } else {
      if (!args.courseId) {
        return pinToolJson('cache_pin', {
          ok: false,
          reason: 'invalid_args',
          message: 'courseId is required for resource_type=content',
        });
      }
      accountScope = requireActiveEclassAccountScope();
      cacheKey = buildContentCacheKey(args.courseId, accountScope);
    }

    const resource_key = canonicalResourceKey(resource_type, normalizedArgs);
    const pinId = computePinId(resource_type, resource_key, accountScope);
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
      accountScope,
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
    if (e instanceof EclassAccountScopeUnavailableError) {
      return pinToolJson('cache_pin', {
        ok: false,
        reason: 'account_scope_unavailable',
        message: e.message,
      });
    }
    if (e instanceof ValidationError) {
      return pinToolJson('cache_pin', {
        ok: false,
        reason: 'invalid_args',
        message: e.message,
        details: e.details,
      });
    }
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
    const accountScope = requireActiveEclassAccountScope();
    let pins = getAllPins(accountScope);
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
    if (e instanceof EclassAccountScopeUnavailableError) {
      return pinToolJson('cache_list_pins', {
        ok: false,
        reason: 'account_scope_unavailable',
        message: e.message,
      });
    }
    const message = e instanceof Error ? e.message : String(e);
    return pinToolJson('cache_list_pins', {
      ok: false,
      reason: 'error',
      message,
    });
  }
}

export async function cacheRefreshPin(
  args: { pinId: string },
  authRetryAttempted: boolean = false
): Promise<PinToolResult> {
  try {
    const accountScope = requireActiveEclassAccountScope();
    const pin = getPinById(args.pinId, accountScope);
    if (!pin) {
      return pinToolJson('cache_refresh_pin', {
        ok: false,
        reason: 'not_found',
        pinId: args.pinId,
      });
    }

    const runRefresh = async (): Promise<void> => {
      let result: {
        content?: Array<{ text?: string } | Record<string, unknown>>;
      };
      if (pin.resource_type === 'file') {
        const { fileUrl, startPage, endPage } = parseFileResourceKey(
          pin.resource_key
        );
        const safeFileUrl = validateUrlForPolicy(fileUrl, 'eclass_file');
        result = await getFileText('unknown', safeFileUrl, startPage, endPage);
      } else if (pin.resource_type === 'sectiontext') {
        const safeSectionUrl = validateUrlForPolicy(
          pin.resource_key,
          'eclass_section'
        );
        result = await getSectionText(safeSectionUrl);
      } else {
        result = await getCourseContent(pin.resource_key);
      }

      const authMessage = getAuthRequiredMessage(result);
      if (authMessage) {
        throw new SessionExpiredError(authMessage);
      }
    };

    await runRefresh();

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
    if (e instanceof EclassAccountScopeUnavailableError) {
      return pinToolJson('cache_refresh_pin', {
        ok: false,
        reason: 'account_scope_unavailable',
        message: e.message,
      });
    }
    if (e instanceof SessionExpiredError) {
      const fallback = (error: SessionExpiredError) =>
        pinToolJson('cache_refresh_pin', {
          ok: false,
          reason: 'session_expired',
          code: 'SESSION_EXPIRED',
          message: error.message,
          retry: {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          },
        });
      if (authRetryAttempted) {
        return fallback(e);
      }
      return handleEclassSessionExpired(
        e,
        async () => cacheRefreshPin(args, true),
        fallback
      );
    }
    if (e instanceof ValidationError) {
      return pinToolJson('cache_refresh_pin', {
        ok: false,
        reason: 'invalid_args',
        message: e.message,
        details: e.details,
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
