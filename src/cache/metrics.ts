export const CACHE_METRIC_NAMES = [
  'get_hit',
  'get_miss',
  'get_stale_pinned_hit',
  'expired_unpinned_invalidated',
  'schema_mismatch_invalidated',
  'read_error',
  'write_success',
  'write_error',
  'invalidate_deleted',
  'invalidate_miss',
  'clear_deleted',
  'clear_pinned_skipped',
  'clear_error',
] as const;

export type CacheMetricName = (typeof CACHE_METRIC_NAMES)[number];

export type CacheMetricCounters = Record<CacheMetricName, number>;

export interface CacheMetricsSnapshot {
  process_started_at: string;
  counters: CacheMetricCounters;
}

const processStartedAt = new Date().toISOString();

function createEmptyCounters(): CacheMetricCounters {
  return Object.fromEntries(
    CACHE_METRIC_NAMES.map((name) => [name, 0])
  ) as CacheMetricCounters;
}

const counters = createEmptyCounters();

export function recordCacheMetric(
  name: CacheMetricName,
  count: number = 1
): void {
  counters[name] += count;
}

export function snapshotCacheMetrics(): CacheMetricsSnapshot {
  return {
    process_started_at: processStartedAt,
    counters: { ...counters },
  };
}

export function resetCacheMetricsForTests(): void {
  for (const name of CACHE_METRIC_NAMES) {
    counters[name] = 0;
  }
}
