import fs from 'fs';
import path from 'path';
import {
  CACHE_DIR,
  CACHE_SCHEMA_VERSION,
  isCacheEntryExpired,
  sanitizeCacheKeyForFilename,
} from './store';
import {
  getAllPins,
  getPinnedBytes,
  getPinsFilePath,
  getQuotaLimitBytes,
  type PinRecord,
} from './pins';
import { snapshotCacheMetrics, type CacheMetricsSnapshot } from './metrics';

export type CacheHealthWarningCode =
  | 'CACHE_DIR_MISSING'
  | 'CACHE_DIR_UNREADABLE'
  | 'INVALID_CACHE_JSON'
  | 'SCHEMA_MISMATCH'
  | 'EXPIRED_UNPINNED'
  | 'STALE_PINNED'
  | 'PIN_CACHE_MISSING'
  | 'PIN_QUOTA_EXCEEDED'
  | 'PINS_FILE_UNREADABLE';

export interface CacheHealthWarning {
  code: CacheHealthWarningCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
  count?: number;
}

export interface CacheScopeHealth {
  scope: string;
  total_entries: number;
  valid_entries: number;
  invalid_json_files: number;
  schema_mismatches: number;
  expired_unpinned_entries: number;
  stale_pinned_entries: number;
  bytes: number;
}

export interface CacheHealthResult {
  ok: true;
  generated_at: string;
  schema_version: number;
  cache: {
    location: string;
    totals: {
      total_files: number;
      json_files: number;
      non_json_files: number;
      total_bytes: number;
      valid_entries: number;
      invalid_json_files: number;
      schema_mismatches: number;
      expired_unpinned_entries: number;
      stale_pinned_entries: number;
      pinned_cache_files: number;
    };
    by_scope: CacheScopeHealth[];
  };
  pins: {
    pins_file_status: 'ok' | 'missing' | 'unreadable';
    pin_count: number;
    missing_cache_files: number;
    quota: {
      used_bytes: number;
      limit_bytes: number;
      used_percent: number | null;
      exceeded: boolean;
    };
  };
  metrics: CacheMetricsSnapshot;
  warnings: CacheHealthWarning[];
}

export interface CollectCacheHealthOptions {
  cacheDir?: string;
  locationLabel?: string;
  schemaVersion?: number;
  now?: Date;
  pins?: PinRecord[];
  pinsFilePath?: string;
  pinQuotaLimitBytes?: number;
  pinnedBytes?: number;
  metrics?: CacheMetricsSnapshot;
}

type CacheEntryCandidate = {
  version?: unknown;
  expires_at?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cacheFilenameForKey(cacheKey: string): string {
  return `${sanitizeCacheKeyForFilename(cacheKey)}.json`;
}

function scopeFromFilename(fileName: string, schemaVersion: number): string {
  const candidates = [
    {
      scope: 'deadlines',
      prefixes: [`v${schemaVersion}:deadlines`, 'deadlines'],
    },
    {
      scope: 'announcements',
      prefixes: [`v${schemaVersion}:announcements`, 'announcements'],
    },
    { scope: 'grades', prefixes: [`v${schemaVersion}:grades`, 'grades'] },
    { scope: 'content', prefixes: [`v${schemaVersion}:content`, 'content'] },
    {
      scope: 'sectiontext',
      prefixes: [`v${schemaVersion}:sectiontext`, 'sectiontext'],
    },
    { scope: 'courses', prefixes: [`v${schemaVersion}:courses`, 'courses'] },
    { scope: 'files', prefixes: [`v${schemaVersion}:file`, 'file'] },
    {
      scope: 'rmp',
      prefixes: [
        `v${schemaVersion}:rmp_search`,
        `v${schemaVersion}:rmp_details`,
        'rmp_search',
        'rmp_details',
      ],
    },
    { scope: 'cengage', prefixes: [`v${schemaVersion}:cengage`, 'cengage'] },
    { scope: 'details', prefixes: [`v${schemaVersion}:details`, 'details'] },
  ];

  for (const candidate of candidates) {
    for (const prefix of candidate.prefixes) {
      if (fileName.startsWith(sanitizeCacheKeyForFilename(prefix))) {
        return candidate.scope;
      }
    }
  }

  return 'unknown';
}

function emptyScope(scope: string): CacheScopeHealth {
  return {
    scope,
    total_entries: 0,
    valid_entries: 0,
    invalid_json_files: 0,
    schema_mismatches: 0,
    expired_unpinned_entries: 0,
    stale_pinned_entries: 0,
    bytes: 0,
  };
}

function addWarning(
  warnings: CacheHealthWarning[],
  warning: CacheHealthWarning
): void {
  if (warning.count === 0) return;
  warnings.push(warning);
}

function pinsFileStatus(pinsFilePath: string): 'ok' | 'missing' | 'unreadable' {
  if (!fs.existsSync(pinsFilePath)) {
    return 'missing';
  }
  try {
    fs.readFileSync(pinsFilePath, 'utf-8');
    return 'ok';
  } catch {
    return 'unreadable';
  }
}

function computePinnedBytes(cacheDir: string, pins: PinRecord[]): number {
  let total = 0;
  const seen = new Set<string>();
  for (const pin of pins) {
    if (seen.has(pin.cacheKey)) continue;
    seen.add(pin.cacheKey);
    const filePath = path.join(cacheDir, cacheFilenameForKey(pin.cacheKey));
    try {
      if (fs.existsSync(filePath)) {
        total += fs.statSync(filePath).size;
      }
    } catch {
      // Health output reports missing counts, but does not expose paths.
    }
  }
  return total;
}

function safePercent(used: number, limit: number): number | null {
  if (limit <= 0) return null;
  return Math.round((used / limit) * 10_000) / 100;
}

export function collectCacheHealth(
  options: CollectCacheHealthOptions = {}
): CacheHealthResult {
  const cacheDir = options.cacheDir ?? CACHE_DIR;
  const schemaVersion = options.schemaVersion ?? CACHE_SCHEMA_VERSION;
  const now = options.now ?? new Date();
  const pins = options.pins ?? getAllPins();
  const pinsFile = options.pinsFilePath ?? getPinsFilePath();
  const pinQuotaLimitBytes = options.pinQuotaLimitBytes ?? getQuotaLimitBytes();
  const pinnedBytes =
    options.pinnedBytes ??
    (options.cacheDir || options.pins
      ? computePinnedBytes(cacheDir, pins)
      : getPinnedBytes());
  const pinnedFilenames = new Set(
    pins.map((pin) => cacheFilenameForKey(pin.cacheKey))
  );
  const warnings: CacheHealthWarning[] = [];
  const byScope = new Map<string, CacheScopeHealth>();
  const totals = {
    total_files: 0,
    json_files: 0,
    non_json_files: 0,
    total_bytes: 0,
    valid_entries: 0,
    invalid_json_files: 0,
    schema_mismatches: 0,
    expired_unpinned_entries: 0,
    stale_pinned_entries: 0,
    pinned_cache_files: 0,
  };

  const pinStatus = pinsFileStatus(pinsFile);
  if (pinStatus === 'unreadable') {
    addWarning(warnings, {
      code: 'PINS_FILE_UNREADABLE',
      severity: 'warning',
      message: 'Pin registry exists but could not be read.',
    });
  }

  let missingPinFiles = 0;
  for (const pin of pins) {
    const pinFile = path.join(cacheDir, cacheFilenameForKey(pin.cacheKey));
    if (!fs.existsSync(pinFile)) {
      missingPinFiles += 1;
    }
  }

  if (!fs.existsSync(cacheDir)) {
    addWarning(warnings, {
      code: 'CACHE_DIR_MISSING',
      severity: 'info',
      message: 'Cache directory does not exist yet.',
    });
  } else {
    try {
      const files = fs.readdirSync(cacheDir);
      for (const fileName of files) {
        const filePath = path.join(cacheDir, fileName);
        let fileBytes = 0;
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;
          fileBytes = stat.size;
        } catch {
          totals.non_json_files += 1;
          continue;
        }

        totals.total_files += 1;
        totals.total_bytes += fileBytes;

        if (!fileName.endsWith('.json')) {
          totals.non_json_files += 1;
          continue;
        }

        totals.json_files += 1;
        const scopeName = scopeFromFilename(fileName, schemaVersion);
        const scope = byScope.get(scopeName) ?? emptyScope(scopeName);
        scope.total_entries += 1;
        scope.bytes += fileBytes;
        byScope.set(scopeName, scope);

        if (pinnedFilenames.has(fileName)) {
          totals.pinned_cache_files += 1;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          totals.invalid_json_files += 1;
          scope.invalid_json_files += 1;
          continue;
        }

        const candidate: CacheEntryCandidate = isObject(parsed) ? parsed : {};
        const expiresAt =
          typeof candidate.expires_at === 'string'
            ? candidate.expires_at
            : undefined;

        if (
          candidate.version !== schemaVersion ||
          expiresAt === undefined ||
          Number.isNaN(new Date(expiresAt).getTime())
        ) {
          totals.schema_mismatches += 1;
          scope.schema_mismatches += 1;
          continue;
        }

        if (isCacheEntryExpired(expiresAt, now)) {
          if (pinnedFilenames.has(fileName)) {
            totals.stale_pinned_entries += 1;
            scope.stale_pinned_entries += 1;
          } else {
            totals.expired_unpinned_entries += 1;
            scope.expired_unpinned_entries += 1;
          }
          continue;
        }

        totals.valid_entries += 1;
        scope.valid_entries += 1;
      }
    } catch {
      addWarning(warnings, {
        code: 'CACHE_DIR_UNREADABLE',
        severity: 'error',
        message: 'Cache directory exists but could not be scanned.',
      });
    }
  }

  addWarning(warnings, {
    code: 'INVALID_CACHE_JSON',
    severity: 'warning',
    message: 'One or more cache JSON files could not be parsed.',
    count: totals.invalid_json_files,
  });
  addWarning(warnings, {
    code: 'SCHEMA_MISMATCH',
    severity: 'warning',
    message: 'One or more cache entries do not match the current schema.',
    count: totals.schema_mismatches,
  });
  addWarning(warnings, {
    code: 'EXPIRED_UNPINNED',
    severity: 'info',
    message: 'One or more unpinned cache entries are expired.',
    count: totals.expired_unpinned_entries,
  });
  addWarning(warnings, {
    code: 'STALE_PINNED',
    severity: 'info',
    message: 'One or more pinned cache entries are stale but retained.',
    count: totals.stale_pinned_entries,
  });
  addWarning(warnings, {
    code: 'PIN_CACHE_MISSING',
    severity: 'warning',
    message: 'One or more pins point at missing cache files.',
    count: missingPinFiles,
  });

  const quotaExceeded =
    pinQuotaLimitBytes >= 0 && pinnedBytes > pinQuotaLimitBytes;
  if (quotaExceeded) {
    addWarning(warnings, {
      code: 'PIN_QUOTA_EXCEEDED',
      severity: 'warning',
      message: 'Pinned cache bytes exceed the configured pin quota.',
    });
  }

  return {
    ok: true,
    generated_at: now.toISOString(),
    schema_version: schemaVersion,
    cache: {
      location: options.locationLabel ?? '.eclass-mcp/cache',
      totals,
      by_scope: Array.from(byScope.values()).sort((a, b) =>
        a.scope.localeCompare(b.scope)
      ),
    },
    pins: {
      pins_file_status: pinStatus,
      pin_count: pins.length,
      missing_cache_files: missingPinFiles,
      quota: {
        used_bytes: pinnedBytes,
        limit_bytes: pinQuotaLimitBytes,
        used_percent: safePercent(pinnedBytes, pinQuotaLimitBytes),
        exceeded: quotaExceeded,
      },
    },
    metrics: options.metrics ?? snapshotCacheMetrics(),
    warnings,
  };
}
