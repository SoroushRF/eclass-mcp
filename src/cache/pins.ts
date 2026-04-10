import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { sanitizeHttpUrlQueryParams } from '../scraper/eclass/helpers';
import { getCacheKey, sanitizeCacheKeyForFilename } from './store';

const CACHE_ROOT_LOCAL = path.resolve(__dirname, '../../.eclass-mcp');
const CACHE_DIR_LOCAL = path.join(CACHE_ROOT_LOCAL, 'cache');

function getCacheFilePathForKeyLocal(cacheKey: string): string {
  return path.join(
    CACHE_DIR_LOCAL,
    `${sanitizeCacheKeyForFilename(cacheKey)}.json`
  );
}

dotenv.config({ quiet: true });

const PINS_FILE_VERSION = 1 as const;

export type PinResourceType = 'file' | 'sectiontext' | 'content';

export interface PinRecord {
  pinId: string;
  resource_type: PinResourceType;
  /** Stable string for identity (e.g. fileUrl|p1-end, sanitized URL, courseId) */
  resource_key: string;
  cacheKey: string;
  pinned_at: string;
  note?: string;
}

interface PinsFile {
  version: typeof PINS_FILE_VERSION;
  pins: Record<string, PinRecord>;
}

const PINS_PATH = path.join(CACHE_ROOT_LOCAL, 'pins.json');

/** Default pin quota: 300 MiB */
const DEFAULT_PIN_QUOTA_BYTES = 300 * 1024 * 1024;

let pinsMemoryCache: PinsFile | null = null;

function ensurePinsDir(): void {
  const dir = path.dirname(PINS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getPinsFilePath(): string {
  return PINS_PATH;
}

export function getQuotaLimitBytes(): number {
  const raw = process.env.ECLASS_MCP_PIN_QUOTA_BYTES;
  if (!raw || raw.trim() === '') return DEFAULT_PIN_QUOTA_BYTES;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PIN_QUOTA_BYTES;
  return n;
}

export function computePinId(
  resource_type: PinResourceType,
  resource_key: string
): string {
  const h = crypto.createHash('sha256');
  h.update(`${resource_type}:${resource_key}`);
  return h.digest('hex').slice(0, 16);
}

/** Build cache key exactly as getFileText does. */
export function buildFileCacheKey(
  fileUrl: string,
  startPage?: number,
  endPage?: number
): string {
  let cacheKey = getCacheKey('file', fileUrl);
  if (startPage !== undefined || endPage !== undefined) {
    cacheKey = getCacheKey(
      'file',
      fileUrl,
      `p${startPage ?? 1}-${endPage ?? 'end'}`
    );
  }
  return cacheKey;
}

export function buildSectionTextCacheKey(url: string): string {
  const targetUrl = sanitizeHttpUrlQueryParams(url);
  return getCacheKey('sectiontext', targetUrl);
}

export function buildContentCacheKey(courseId: string): string {
  return getCacheKey('content', courseId);
}

export function canonicalResourceKey(
  resource_type: PinResourceType,
  args: {
    fileUrl?: string;
    startPage?: number;
    endPage?: number;
    url?: string;
    courseId?: string;
  }
): string {
  if (resource_type === 'file') {
    const u = args.fileUrl ?? '';
    const range =
      args.startPage !== undefined || args.endPage !== undefined
        ? `|p${args.startPage ?? 1}-${args.endPage ?? 'end'}`
        : '';
    return `${u}${range}`;
  }
  if (resource_type === 'sectiontext') {
    return sanitizeHttpUrlQueryParams(args.url ?? '');
  }
  return args.courseId ?? '';
}

export function loadPins(): PinsFile {
  if (pinsMemoryCache) return pinsMemoryCache;
  if (!fs.existsSync(PINS_PATH)) {
    pinsMemoryCache = { version: PINS_FILE_VERSION, pins: {} };
    return pinsMemoryCache;
  }
  try {
    const raw = fs.readFileSync(PINS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as PinsFile;
    if (!parsed.pins || typeof parsed.pins !== 'object') {
      pinsMemoryCache = { version: PINS_FILE_VERSION, pins: {} };
      return pinsMemoryCache;
    }
    pinsMemoryCache = {
      version: PINS_FILE_VERSION,
      pins: parsed.pins,
    };
    return pinsMemoryCache;
  } catch {
    pinsMemoryCache = { version: PINS_FILE_VERSION, pins: {} };
    return pinsMemoryCache;
  }
}

export function invalidatePinsMemoryCache(): void {
  pinsMemoryCache = null;
}

export function savePins(data: PinsFile): void {
  ensurePinsDir();
  const tmp = `${PINS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, PINS_PATH);
  pinsMemoryCache = data;
}

/** Filenames in cache dir (e.g. v1_file_https___....json) that are pinned. */
export function getPinnedCacheFilenames(): Set<string> {
  const { pins } = loadPins();
  const set = new Set<string>();
  for (const pin of Object.values(pins)) {
    set.add(`${sanitizeCacheKeyForFilename(pin.cacheKey)}.json`);
  }
  return set;
}

export function isCacheKeyPinned(cacheKey: string): boolean {
  const { pins } = loadPins();
  for (const pin of Object.values(pins)) {
    if (pin.cacheKey === cacheKey) return true;
  }
  return false;
}

export function getPinById(pinId: string): PinRecord | undefined {
  return loadPins().pins[pinId];
}

export function getAllPins(): PinRecord[] {
  return Object.values(loadPins().pins);
}

export function getPinnedBytes(): number {
  const { pins } = loadPins();
  let total = 0;
  const seen = new Set<string>();
  for (const pin of Object.values(pins)) {
    if (seen.has(pin.cacheKey)) continue;
    seen.add(pin.cacheKey);
    const fp = getCacheFilePathForKeyLocal(pin.cacheKey);
    try {
      if (fs.existsSync(fp)) {
        total += fs.statSync(fp).size;
      }
    } catch {
      // ignore
    }
  }
  return total;
}

/** Bytes for a single cache key file if it exists, else 0 */
export function getCacheKeyFileSizeBytes(cacheKey: string): number {
  const fp = getCacheFilePathForKeyLocal(cacheKey);
  try {
    if (fs.existsSync(fp)) return fs.statSync(fp).size;
  } catch {
    // ignore
  }
  return 0;
}

export type QuotaCheckResult =
  | {
      ok: true;
      used_bytes: number;
      would_use_bytes: number;
      limit_bytes: number;
    }
  | {
      ok: false;
      reason: 'quota_exceeded';
      used_bytes: number;
      would_use_bytes: number;
      limit_bytes: number;
    };

/**
 * Check if adding/replacing pin for cacheKey stays within quota.
 * Skips the row being updated when existingPinId matches.
 */
export function checkPinQuota(
  cacheKey: string,
  existingPinId?: string
): QuotaCheckResult {
  const limit_bytes = getQuotaLimitBytes();
  const { pins } = loadPins();

  let used = 0;
  const countedKeys = new Set<string>();

  for (const pin of Object.values(pins)) {
    if (existingPinId && pin.pinId === existingPinId) continue;
    if (countedKeys.has(pin.cacheKey)) continue;
    countedKeys.add(pin.cacheKey);
    used += getCacheKeyFileSizeBytes(pin.cacheKey);
  }

  const targetSize = getCacheKeyFileSizeBytes(cacheKey);

  if (existingPinId && pins[existingPinId]?.cacheKey === cacheKey) {
    return { ok: true, used_bytes: used, would_use_bytes: 0, limit_bytes };
  }

  if (countedKeys.has(cacheKey)) {
    return { ok: true, used_bytes: used, would_use_bytes: 0, limit_bytes };
  }

  const newTotal = used + targetSize;
  if (newTotal > limit_bytes) {
    return {
      ok: false,
      reason: 'quota_exceeded',
      used_bytes: used,
      would_use_bytes: targetSize,
      limit_bytes,
    };
  }
  return {
    ok: true,
    used_bytes: used,
    would_use_bytes: targetSize,
    limit_bytes,
  };
}

export function upsertPin(record: PinRecord): void {
  const data = loadPins();
  data.pins[record.pinId] = record;
  savePins(data);
}

export function removePin(pinId: string): boolean {
  const data = loadPins();
  if (!data.pins[pinId]) return false;
  delete data.pins[pinId];
  savePins(data);
  return true;
}

export function removePinsByFilter(
  predicate: (p: PinRecord) => boolean
): PinRecord[] {
  const data = loadPins();
  const removed: PinRecord[] = [];
  for (const id of Object.keys(data.pins)) {
    const p = data.pins[id];
    if (predicate(p)) {
      removed.push(p);
      delete data.pins[id];
    }
  }
  if (removed.length) savePins(data);
  return removed;
}
