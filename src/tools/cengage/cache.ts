import { createHash } from 'crypto';
import { attachCacheMeta, getCacheKey } from '../../cache/store';

export interface CengageCacheMeta {
  hit: boolean;
  fetched_at: string;
  expires_at: string;
  stale?: boolean;
}

function createCacheDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function cengageCacheKey(scope: string, value: unknown): string {
  return getCacheKey('cengage', scope, createCacheDigest(value));
}

export function toCacheHitMeta(cached: {
  fetched_at: string;
  expires_at: string;
  stale?: boolean;
}): CengageCacheMeta {
  return {
    hit: true,
    fetched_at: cached.fetched_at,
    expires_at: cached.expires_at,
    ...(cached.stale ? { stale: true } : {}),
  };
}

export function toCacheMissMeta(ttlMinutes: number): CengageCacheMeta {
  const now = new Date();
  return {
    hit: false,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMinutes * 60000).toISOString(),
  };
}

export function withCacheMeta<T extends Record<string, unknown>>(
  payload: T,
  meta: CengageCacheMeta
): T & { _cache: CengageCacheMeta } {
  return attachCacheMeta(payload, meta) as unknown as T & {
    _cache: CengageCacheMeta;
  };
}
