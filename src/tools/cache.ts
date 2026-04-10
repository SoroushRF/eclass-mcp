import { cache } from '../cache/store';

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

export async function clearCache(scope: CacheScope = 'all') {
  try {
    console.error(
      `[MCP Server] Manual cache clear requested for scope: ${scope}`
    );

    let clearedCount = 0;

    switch (scope) {
      case 'volatile':
        clearedCount = cache.clearVolatile();
        break;
      case 'deadlines':
        clearedCount = cache.clearByPrefix('deadlines');
        break;
      case 'announcements':
        clearedCount = cache.clearByPrefix('announcements');
        break;
      case 'grades':
        clearedCount = cache.clearByPrefix('grades');
        break;
      case 'content':
        clearedCount =
          cache.clearByPrefix('content') + cache.clearByPrefix('sectiontext');
        break;
      case 'courses':
        clearedCount = cache.clearByPrefix('courses');
        break;
      case 'files':
        clearedCount = cache.clearByPrefix('file');
        break;
      case 'rmp':
        clearedCount =
          cache.clearByPrefix('rmp_search') +
          cache.clearByPrefix('rmp_details');
        break;
      case 'all':
      default:
        clearedCount = cache.clearByPrefix('');
        break;
    }

    return {
      content: [
        {
          type: 'text' as const,
          text:
            `Successfully cleared default (non-pinned) cache for scope "${scope}". ` +
            `${clearedCount} entries removed. ` +
            `User-pinned cache entries were not deleted. ` +
            `To remove pinned data, use cache_delete_pinned (or cache_unpin to drop the pin without deleting files).`,
        },
      ],
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Failed to clear cache: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
