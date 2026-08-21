import type { Assignment, Course } from '../scraper/eclass';
import { ValidationError } from '../errors/validation-error';
import { cache, TTL, type CacheMetadata } from '../cache/store';
import {
  getEclassCacheKey,
  tryGetEclassCacheKey,
} from '../cache/account-scope';
import type { DeadlineItem } from '../types/deadlines';
import {
  createDefaultToolDependencies,
  type EclassScraperDependency,
} from './dependencies';

export type DeadlineScope = 'upcoming' | 'month' | 'range';

const EMPTY_RESULT_TTL_MINUTES = 5;

export interface GetEclassDeadlineParams {
  courseId?: string;
  scope?: DeadlineScope;
  month?: number;
  year?: number;
  from?: string;
  to?: string;
}

export interface EclassCoursesWithCache {
  courses: Course[];
  cacheMeta: CacheMetadata;
}

export interface EclassDeadlineItemsWithCache {
  items: DeadlineItem[];
  cacheMeta: CacheMetadata;
}

export function parseEClassDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const raw = dateStr.trim();

  let d = new Date(raw);
  if (!isNaN(d.getTime())) return d;

  const now = new Date();
  const currentYear = now.getFullYear();
  const match = raw.match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (match) {
    const day = match[1];
    const month = match[2];
    d = new Date(`${month} ${day}, ${currentYear}`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function isSameMonthYear(date: Date, month: number, year: number): boolean {
  return date.getMonth() + 1 === month && date.getFullYear() === year;
}

function parseBoundaryDate(raw: string, isEndBoundary: boolean): Date {
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    throw new ValidationError('Invalid date boundary', { value: raw });
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    if (isEndBoundary) {
      d.setHours(23, 59, 59, 999);
    } else {
      d.setHours(0, 0, 0, 0);
    }
  }
  return d;
}

export function deadlineCacheKey(
  scope: DeadlineScope,
  courseId?: string,
  extra?: string
) {
  const coursePart = courseId || 'all';
  return getEclassCacheKey('deadlines', scope, coursePart, extra || '');
}

function inferTypeFromUrl(url: string): 'assign' | 'quiz' | 'other' {
  const u = (url || '').toLowerCase();
  if (u.includes('/mod/assign/')) return 'assign';
  if (u.includes('/mod/quiz/')) return 'quiz';
  if (u.includes('assign')) return 'assign';
  if (u.includes('quiz')) return 'quiz';
  return 'other';
}

export function toDeadlineItems(assignments: Assignment[]): DeadlineItem[] {
  return assignments.map((a) => ({ ...a, type: inferTypeFromUrl(a.url) }));
}

function freshCacheMeta(ttlMinutes: number): CacheMetadata {
  const now = new Date();
  return {
    hit: false,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMinutes * 60000).toISOString(),
  };
}

function ttlForList<T>(items: T[], normalTtlMinutes: number): number {
  return items.length > 0 ? normalTtlMinutes : EMPTY_RESULT_TTL_MINUTES;
}

function hitCacheMeta(cached: {
  fetched_at: string;
  expires_at: string;
  stale?: boolean;
}): CacheMetadata {
  return {
    hit: true,
    fetched_at: cached.fetched_at,
    expires_at: cached.expires_at,
    ...(cached.stale ? { stale: true } : {}),
  };
}

export async function getEclassCoursesWithCache(
  eclassScraper: EclassScraperDependency = createDefaultToolDependencies()
    .eclassScraper
): Promise<EclassCoursesWithCache> {
  const cacheKey = tryGetEclassCacheKey('courses');
  const cached = cacheKey ? cache.getWithMeta<Course[]>(cacheKey) : null;

  if (cached) {
    return {
      courses: cached.data,
      cacheMeta: hitCacheMeta(cached),
    };
  }

  const courses = await eclassScraper.getCourses();
  const ttlMinutes = ttlForList(courses, TTL.COURSES);
  if (cacheKey) cache.set(cacheKey, courses, ttlMinutes);

  return {
    courses,
    cacheMeta: freshCacheMeta(ttlMinutes),
  };
}

export async function getEclassDeadlineItems(
  params: GetEclassDeadlineParams,
  eclassScraper: EclassScraperDependency = createDefaultToolDependencies()
    .eclassScraper
): Promise<EclassDeadlineItemsWithCache> {
  const { courseId, scope = 'upcoming', month, year, from, to } = params || {};

  if (scope === 'upcoming') {
    const key = tryGetEclassCacheKey(
      'deadlines',
      'upcoming',
      courseId || 'all',
      ''
    );
    const cached = key ? cache.getWithMeta<Assignment[]>(key) : null;
    if (cached) {
      return {
        items: toDeadlineItems(cached.data),
        cacheMeta: hitCacheMeta(cached),
      };
    }

    const deadlines = await eclassScraper.getDeadlines(courseId);
    const ttlMinutes = ttlForList(deadlines, TTL.DEADLINES);
    if (key) cache.set(key, deadlines, ttlMinutes);
    return {
      items: toDeadlineItems(deadlines),
      cacheMeta: freshCacheMeta(ttlMinutes),
    };
  }

  if (scope === 'month') {
    const m = month ?? new Date().getMonth() + 1;
    const y = year ?? new Date().getFullYear();
    const extra = `${y}_${m}`;
    const key = tryGetEclassCacheKey(
      'deadlines',
      'month',
      courseId || 'all',
      extra
    );
    const cached = key ? cache.getWithMeta<DeadlineItem[]>(key) : null;
    if (cached) {
      return {
        items: cached.data,
        cacheMeta: hitCacheMeta(cached),
      };
    }

    const allAssignments =
      await eclassScraper.getAllAssignmentDeadlines(courseId);
    const items = allAssignments.filter((it) => {
      const d = parseEClassDate(it.dueDate);
      return d ? isSameMonthYear(d, m, y) : false;
    });
    const ttlMinutes = ttlForList(items, TTL.DEADLINES);
    if (key) cache.set(key, items, ttlMinutes);
    return { items, cacheMeta: freshCacheMeta(ttlMinutes) };
  }

  if (!from || !to) {
    const missing: string[] = [];
    if (!from) missing.push('from');
    if (!to) missing.push('to');
    throw new ValidationError('scope=range requires both from and to', {
      scope: 'range',
      missing,
    });
  }

  const fromDate = parseBoundaryDate(from, false);
  const toDate = parseBoundaryDate(to, true);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new ValidationError('Invalid from/to date. Use ISO or YYYY-MM-DD.', {
      from,
      to,
    });
  }

  const extra = `${fromDate.toISOString().slice(0, 10)}_${toDate
    .toISOString()
    .slice(0, 10)}`;
  const key = tryGetEclassCacheKey(
    'deadlines',
    'range',
    courseId || 'all',
    extra
  );
  const cached = key ? cache.getWithMeta<DeadlineItem[]>(key) : null;
  if (cached) {
    return {
      items: cached.data,
      cacheMeta: hitCacheMeta(cached),
    };
  }

  const allAssignments =
    await eclassScraper.getAllAssignmentDeadlines(courseId);
  const filtered = allAssignments.filter((it) => {
    const d = parseEClassDate(it.dueDate);
    if (!d) return false;
    return d >= fromDate && d <= toDate;
  });

  const seen = new Set<string>();
  const items = filtered.filter((it) => {
    const k = it.url || it.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const ttlMinutes = ttlForList(items, TTL.DEADLINES);
  if (key) cache.set(key, items, ttlMinutes);
  return { items, cacheMeta: freshCacheMeta(ttlMinutes) };
}
