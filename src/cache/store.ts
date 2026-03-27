import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const CACHE_ROOT = path.resolve(__dirname, '../../.eclass-mcp');
const CACHE_DIR = path.join(CACHE_ROOT, 'cache');

/** 
 * Increment this version whenever the JSON structure of cached data changes.
 * This ensures that old, incompatible cache files are naturally ignored.
 */
export const CACHE_SCHEMA_VERSION = 1;

export const TTL = {
  COURSES: 360, // 6 hours (previously 24h)
  CONTENT: 180, // 3 hours (previously 6h)
  DEADLINES: 30, // 30 minutes (previously 2h)
  DETAILS: 20, // 20 minutes (previously 1h)
  ANNOUNCEMENTS: 30, // 30 minutes (previously 1h)
  GRADES: 180, // 3 hours (previously 12h)
  FILES: 2880, // 48 hours (previously 7 days)
  RMP: 10080, // 7 days
};

export interface CacheEntry<T> {
  expires_at: string;
  fetched_at: string;
  data: T;
  version: number;
}

/** Sanitize cache key segment for a safe filename (used by CacheStore). */
export function sanitizeCacheKeyForFilename(key: string): string {
  return key.replace(/[^a-z0-9_-]/gi, '_');
}

/** Generates a consistent cache key with schema versioning. */
export function getCacheKey(prefix: string, ...segments: string[]): string {
  const base = [prefix, ...segments].join(':');
  return `v${CACHE_SCHEMA_VERSION}:${base}`;
}

/** Whether a cache entry should be treated as expired at `now`. */
export function isCacheEntryExpired(expiresAtIso: string, now: Date): boolean {
  return now > new Date(expiresAtIso);
}

export interface CacheMetadata {
  hit: boolean;
  fetched_at: string;
  expires_at: string;
}

/** 
 * Wraps a tool response with cache freshness metadata.
 * Use this in MCP tool handlers to return a consistent envelope.
 */
export function attachCacheMeta<T>(data: T, meta: CacheMetadata) {
  return {
    ...data,
    _cache: meta,
  };
}

class CacheStore {
  constructor() {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
    } catch (e: any) {
      console.error(
        `CRITICAL: Could not create cache directory at ${CACHE_DIR}:`,
        e.message
      );
    }
  }

  private getFilePath(key: string): string {
    return path.join(CACHE_DIR, `${sanitizeCacheKeyForFilename(key)}.json`);
  }

  /** Gets only the raw cached data, preserving legacy API behavior. */
  get<T>(key: string): T | null {
    const entry = this.getWithMeta<T>(key);
    return entry ? entry.data : null;
  }

  /** Gets full cache entry with metadata (fetched_at, expires_at). */
  getWithMeta<T>(key: string): CacheEntry<T> | null {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Invalidate if version mismatch (protection against manual key bypass)
      if (entry.version !== CACHE_SCHEMA_VERSION) {
        this.invalidate(key);
        return null;
      }

      const now = new Date();
      if (isCacheEntryExpired(entry.expires_at, now)) {
        this.invalidate(key);
        return null;
      }

      return entry;
    } catch (error) {
      console.error(`Error reading cache for key "${key}":`, error);
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMinutes: number): void {
    const filePath = this.getFilePath(key);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60000);

    const entry: CacheEntry<T> = {
      expires_at: expiresAt.toISOString(),
      fetched_at: now.toISOString(),
      data: value,
      version: CACHE_SCHEMA_VERSION,
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error writing cache for key "${key}":`, error);
    }
  }

  invalidate(key: string): void {
    const filePath = this.getFilePath(key);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`Error invalidating cache for key "${key}":`, error);
      }
    }
  }

  /** Clears all cache entries that start with a specific prefix (e.g. "v1:deadlines"). */
  clearByPrefix(prefix: string): number {
    if (!fs.existsSync(CACHE_DIR)) return 0;
    let count = 0;
    try {
      const files = fs.readdirSync(CACHE_DIR);
      const sanitizedPrefix = sanitizeCacheKeyForFilename(prefix);
      for (const file of files) {
        if (file.startsWith(sanitizedPrefix) && file.endsWith('.json')) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
          count++;
        }
      }
    } catch (error) {
      console.error(`Error clearing cache by prefix "${prefix}":`, error);
    }
    return count;
  }

  /** Clears high-volatility cache (deadlines, announcements, grades). */
  clearVolatile(): number {
    const volatilePrefixes = ['deadlines', 'announcements', 'grades'];
    let total = 0;
    for (const p of volatilePrefixes) {
      // Clear both versioned and legacy keys for these prefixes
      total += this.clearByPrefix(`v${CACHE_SCHEMA_VERSION}:${p}`);
      total += this.clearByPrefix(p); 
    }
    return total;
  }

  clear(): void {
    if (!fs.existsSync(CACHE_DIR)) return;

    try {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        }
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }
}

export const cache = new CacheStore();
