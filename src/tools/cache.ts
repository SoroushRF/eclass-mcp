import { CACHE_SCHEMA_VERSION, cache } from '../cache/store';
import { collectCacheHealth } from '../cache/health';
import { getLogger } from '../logging/context';
import {
  CacheHealthToolResponseSchema,
  ClearCacheToolResponseSchema,
} from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';

export type CacheScope =
  | 'all'
  | 'volatile'
  | 'deadlines'
  | 'announcements'
  | 'grades'
  | 'content'
  | 'courses'
  | 'files'
  | 'rmp';

function clearVersionedAndLegacyPrefixes(...prefixes: string[]): number {
  let total = 0;
  for (const prefix of prefixes) {
    total += cache.clearByPrefix(`v${CACHE_SCHEMA_VERSION}:${prefix}`);
    total += cache.clearByPrefix(prefix);
  }
  return total;
}

export async function clearCache(scope: CacheScope = 'all') {
  try {
    getLogger().info({ scope }, 'Manual cache clear requested');

    let clearedCount = 0;

    switch (scope) {
      case 'volatile':
        clearedCount = cache.clearVolatile();
        break;
      case 'deadlines':
        clearedCount = clearVersionedAndLegacyPrefixes('deadlines');
        break;
      case 'announcements':
        clearedCount = clearVersionedAndLegacyPrefixes('announcements');
        break;
      case 'grades':
        clearedCount = clearVersionedAndLegacyPrefixes('grades');
        break;
      case 'content':
        clearedCount = clearVersionedAndLegacyPrefixes(
          'content',
          'sectiontext'
        );
        break;
      case 'courses':
        clearedCount = clearVersionedAndLegacyPrefixes('courses');
        break;
      case 'files':
        clearedCount = clearVersionedAndLegacyPrefixes('file');
        break;
      case 'rmp':
        clearedCount = clearVersionedAndLegacyPrefixes(
          'rmp_search',
          'rmp_details'
        );
        break;
      case 'all':
      default:
        clearedCount = cache.clearByPrefix('');
        break;
    }

    return asValidatedMcpText('clear_cache', ClearCacheToolResponseSchema, {
      ok: true,
      scope,
      clearedCount,
      message:
        `Successfully cleared default (non-pinned) cache for scope "${scope}". ` +
        `${clearedCount} entries removed. ` +
        `User-pinned cache entries were not deleted. ` +
        `To remove pinned data, use cache_delete_pinned (or cache_unpin to drop the pin without deleting files).`,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ...asValidatedMcpText('clear_cache', ClearCacheToolResponseSchema, {
        ok: false,
        message: `Failed to clear cache: ${message}`,
        isError: true,
      }),
      isError: true as const,
    };
  }
}

export async function cacheHealth() {
  return asValidatedMcpText(
    'cache_health',
    CacheHealthToolResponseSchema,
    collectCacheHealth()
  );
}
