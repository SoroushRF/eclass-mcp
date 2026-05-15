import fs from 'fs';
import path from 'path';
import { CACHE_ROOT } from '../../cache/store';

export const COURSE_PLATFORM_INDEX_VERSION = 1 as const;

export type CoursePlatformStatus =
  | 'linked'
  | 'not_found'
  | 'ambiguous'
  | 'auth_required'
  | 'disabled';

export type CoursePlatformSelectionSource =
  | 'auto_match'
  | 'user_selection'
  | 'manual_override';

export interface CoursePlatformEClassIdentity {
  courseId?: string;
  courseName?: string;
  courseCode?: string;
  url?: string;
}

export interface CoursePlatformCengageMapping {
  status: CoursePlatformStatus;
  courseId?: string;
  courseKey?: string;
  title?: string;
  launchUrl?: string;
  platform?: 'webassign' | 'cengage' | 'owlv2';
  assignmentsSupported?: boolean;
  confidence?: number;
  selectedBy?: CoursePlatformSelectionSource;
  matchedAt?: string;
  lastCheckedAt?: string;
  assignmentsLastSeenAt?: string;
  activation?: {
    status: 'unknown' | 'verified' | 'failed';
    verifiedAt?: string;
    failedAt?: string;
    actualCourseTitle?: string;
    actualCurrentSelected?: string;
    expectedCourseKey?: string;
    lastErrorCode?: string;
  };
  candidates?: Array<{
    courseId?: string;
    courseKey?: string;
    title: string;
    launchUrl: string;
    platform?: 'webassign' | 'cengage' | 'owlv2';
    assignmentsSupported?: boolean;
    confidence?: number;
  }>;
  diagnostics?: Record<string, unknown>;
}

export interface CoursePlatformRecord {
  recordId: string;
  eclass: CoursePlatformEClassIdentity;
  termKey?: string;
  platforms: {
    cengage?: CoursePlatformCengageMapping;
  };
}

export interface CoursePlatformIndexFile {
  version: typeof COURSE_PLATFORM_INDEX_VERSION;
  updated_at: string;
  records: Record<string, CoursePlatformRecord>;
}

const COURSE_PLATFORM_INDEX_PATH = path.join(
  CACHE_ROOT,
  'course-platform-index.json'
);

let indexMemoryCache: CoursePlatformIndexFile | null = null;

function ensureIndexDir(): void {
  const dir = path.dirname(COURSE_PLATFORM_INDEX_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function isTransientReplaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EEXIST';
}

function replaceFileWithRetry(tmpPath: string, targetPath: string): void {
  const maxAttempts = process.platform === 'win32' ? 5 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientReplaceError(error)) break;

      try {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { force: true });
        }
      } catch {
        // Best-effort cleanup; retry below handles transient Windows locks.
      }

      if (attempt < maxAttempts - 1) {
        sleepSync(25 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

export function getCoursePlatformIndexPath(): string {
  return COURSE_PLATFORM_INDEX_PATH;
}

export function normalizeCourseCode(value: string | undefined): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function computeCoursePlatformRecordId(
  identity: CoursePlatformEClassIdentity
): string {
  const courseId = (identity.courseId || '').trim();
  if (courseId) return `eclass:${courseId}`;

  const courseCode = normalizeCourseCode(identity.courseCode);
  if (courseCode) return `code:${courseCode}`;

  const courseName = (identity.courseName || '').trim().toLowerCase();
  if (courseName) return `name:${courseName.replace(/[^a-z0-9]+/g, '_')}`;

  return 'unknown';
}

export function loadCoursePlatformIndex(): CoursePlatformIndexFile {
  if (indexMemoryCache) return indexMemoryCache;

  if (!fs.existsSync(COURSE_PLATFORM_INDEX_PATH)) {
    indexMemoryCache = {
      version: COURSE_PLATFORM_INDEX_VERSION,
      updated_at: new Date(0).toISOString(),
      records: {},
    };
    return indexMemoryCache;
  }

  try {
    const raw = fs.readFileSync(COURSE_PLATFORM_INDEX_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CoursePlatformIndexFile;
    if (!parsed.records || typeof parsed.records !== 'object') {
      throw new Error('Invalid course platform index records');
    }

    indexMemoryCache = {
      version: COURSE_PLATFORM_INDEX_VERSION,
      updated_at:
        typeof parsed.updated_at === 'string'
          ? parsed.updated_at
          : new Date(0).toISOString(),
      records: parsed.records,
    };
    return indexMemoryCache;
  } catch {
    indexMemoryCache = {
      version: COURSE_PLATFORM_INDEX_VERSION,
      updated_at: new Date(0).toISOString(),
      records: {},
    };
    return indexMemoryCache;
  }
}

export function invalidateCoursePlatformIndexMemoryCache(): void {
  indexMemoryCache = null;
}

export function saveCoursePlatformIndex(data: CoursePlatformIndexFile): void {
  ensureIndexDir();
  const payload: CoursePlatformIndexFile = {
    version: COURSE_PLATFORM_INDEX_VERSION,
    updated_at: data.updated_at || new Date().toISOString(),
    records: data.records || {},
  };
  const tmp = `${COURSE_PLATFORM_INDEX_PATH}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  try {
    replaceFileWithRetry(tmp, COURSE_PLATFORM_INDEX_PATH);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) {
        fs.rmSync(tmp, { force: true });
      }
    } catch {
      // Ignore temp cleanup errors so the original write failure is preserved.
    }
    throw error;
  }
  indexMemoryCache = payload;
}

export function getCoursePlatformRecord(
  identity: CoursePlatformEClassIdentity
): CoursePlatformRecord | undefined {
  const data = loadCoursePlatformIndex();
  const recordId = computeCoursePlatformRecordId(identity);
  const exact = data.records[recordId];
  if (exact) return exact;

  const normalizedCode = normalizeCourseCode(identity.courseCode);
  if (!normalizedCode) return undefined;

  return Object.values(data.records).find(
    (record) => normalizeCourseCode(record.eclass.courseCode) === normalizedCode
  );
}

export function upsertCoursePlatformMapping(params: {
  eclass: CoursePlatformEClassIdentity;
  cengage: CoursePlatformCengageMapping;
  termKey?: string;
}): CoursePlatformRecord {
  const data = loadCoursePlatformIndex();
  const existing = getCoursePlatformRecord(params.eclass);
  const desiredRecordId = computeCoursePlatformRecordId(params.eclass);
  const recordId =
    existing?.recordId === desiredRecordId
      ? existing.recordId
      : desiredRecordId;
  const now = new Date().toISOString();
  const record: CoursePlatformRecord = {
    recordId,
    eclass: {
      ...existing?.eclass,
      ...params.eclass,
    },
    termKey: params.termKey ?? existing?.termKey,
    platforms: {
      ...existing?.platforms,
      cengage: {
        ...existing?.platforms.cengage,
        ...params.cengage,
        lastCheckedAt: params.cengage.lastCheckedAt || now,
        matchedAt:
          params.cengage.status === 'linked'
            ? params.cengage.matchedAt ||
              existing?.platforms.cengage?.matchedAt ||
              now
            : params.cengage.matchedAt,
      },
    },
  };

  if (existing?.recordId && existing.recordId !== recordId) {
    delete data.records[existing.recordId];
  }

  data.records[recordId] = record;
  data.updated_at = now;
  saveCoursePlatformIndex(data);
  return record;
}

export function recordCengageNotFound(
  eclass: CoursePlatformEClassIdentity,
  diagnostics?: Record<string, unknown>
): CoursePlatformRecord {
  return upsertCoursePlatformMapping({
    eclass,
    cengage: {
      status: 'not_found',
      selectedBy: 'auto_match',
      lastCheckedAt: new Date().toISOString(),
      diagnostics,
    },
  });
}

export function recordCengageAmbiguous(
  eclass: CoursePlatformEClassIdentity,
  candidates: CoursePlatformCengageMapping['candidates']
): CoursePlatformRecord {
  return upsertCoursePlatformMapping({
    eclass,
    cengage: {
      status: 'ambiguous',
      selectedBy: 'auto_match',
      lastCheckedAt: new Date().toISOString(),
      candidates,
    },
  });
}

export function recordCengageAuthRequired(
  eclass: CoursePlatformEClassIdentity
): CoursePlatformRecord {
  return upsertCoursePlatformMapping({
    eclass,
    cengage: {
      status: 'auth_required',
      selectedBy: 'auto_match',
      lastCheckedAt: new Date().toISOString(),
    },
  });
}
