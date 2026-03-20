import { scraper, SessionExpiredError, Assignment } from '../scraper/eclass';
import { openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';
import { DeadlineItem, ItemDetails } from '../types/deadlines';

type DeadlineScope = 'upcoming' | 'month' | 'range';

function parseEClassDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const raw = dateStr.trim();

  // If it's an ISO-ish datetime, Date can parse it.
  let d = new Date(raw);
  if (!isNaN(d.getTime())) return d;

  // Moodle strings like "Tuesday, 31 March" or "31 March, 11:59 PM"
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
  if (isNaN(d.getTime())) throw new Error('Invalid date boundary');

  // If user passed YYYY-MM-DD, normalize to whole-day boundaries.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    if (isEndBoundary) {
      d.setHours(23, 59, 59, 999);
    } else {
      d.setHours(0, 0, 0, 0);
    }
  }
  return d;
}

export async function getUpcomingDeadlines(_daysAhead: number = 30, courseId?: string) {
  try {
    const cacheKey = `deadlines_${courseId || 'all'}`;
    let deadlines = cache.get<Assignment[]>(cacheKey) || [];

    if (deadlines.length === 0) {
      deadlines = await scraper.getDeadlines(courseId);
      cache.set(cacheKey, deadlines, TTL.DEADLINES);
    }

    // eClass's 'Upcoming events' page only shows future events anyway.
    // Let's just return what the scraper found without extra filtering bugs.
    return { content: [{ type: 'text' as const, text: JSON.stringify(deadlines) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}

function deadlineCacheKey(scope: DeadlineScope, courseId?: string, extra?: string) {
  const coursePart = courseId || 'all';
  return `deadlines_${scope}_${coursePart}${extra ? `_${extra}` : ''}`;
}

function hasUsableItems<T>(value: T[] | null): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

function detailsCacheKey(url: string) {
  // CacheStore already sanitizes; keep key short-ish and deterministic.
  const shortened = url.length > 200 ? url.slice(0, 200) : url;
  return `details_${shortened}`;
}

function inferTypeFromUrl(url: string): 'assign' | 'quiz' | 'other' {
  const u = (url || '').toLowerCase();
  if (u.includes('/mod/assign/')) return 'assign';
  if (u.includes('/mod/quiz/')) return 'quiz';
  if (u.includes('assign')) return 'assign';
  if (u.includes('quiz')) return 'quiz';
  return 'other';
}

function toDeadlineItems(assignments: Assignment[]): DeadlineItem[] {
  return assignments.map((a) => ({ ...a, type: inferTypeFromUrl(a.url) }));
}

async function getDetailsCached(url: string): Promise<ItemDetails> {
  const key = detailsCacheKey(url);
  const cached = cache.get<ItemDetails>(key);
  if (cached) return cached;
  const details = await scraper.getItemDetails(url);
  cache.set(key, details, TTL.DETAILS);
  return details;
}

export async function getDeadlines(params: {
  courseId?: string;
  scope?: DeadlineScope;
  month?: number;
  year?: number;
  from?: string;
  to?: string;
  includeDetails?: boolean;
  maxDetails?: number;
}) {
  const {
    courseId,
    scope = 'upcoming',
    month,
    year,
    from,
    to,
    includeDetails = false,
    maxDetails = 7,
  } = params || {};

  try {
    let items: DeadlineItem[] = [];

    if (scope === 'upcoming') {
      const key = deadlineCacheKey('upcoming', courseId);
      const cached = cache.get<Assignment[]>(key);
      if (hasUsableItems(cached)) {
        items = toDeadlineItems(cached);
      } else {
        const deadlines = await scraper.getDeadlines(courseId);
        cache.set(key, deadlines, TTL.DEADLINES);
        items = toDeadlineItems(deadlines);
      }
    } else if (scope === 'month') {
      const m = month ?? new Date().getMonth() + 1;
      const y = year ?? new Date().getFullYear();
      const extra = `${y}_${m}`;
      const key = deadlineCacheKey('month', courseId, extra);
      const cached = cache.get<DeadlineItem[]>(key);
      if (hasUsableItems(cached)) {
        items = cached;
      } else {
        const allAssignments = await scraper.getAllAssignmentDeadlines(courseId);
        items = allAssignments.filter((it) => {
          const d = parseEClassDate(it.dueDate);
          return d ? isSameMonthYear(d, m, y) : false;
        });
        cache.set(key, items, TTL.DEADLINES);
      }
    } else if (scope === 'range') {
      if (!from || !to) {
        throw new Error('scope=range requires both from and to');
      }
      const fromDate = parseBoundaryDate(from, false);
      const toDate = parseBoundaryDate(to, true);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('Invalid from/to date. Use ISO or YYYY-MM-DD.');
      }
      const extra = `${fromDate.toISOString().slice(0, 10)}_${toDate.toISOString().slice(0, 10)}`;
      const key = deadlineCacheKey('range', courseId, extra);
      const cached = cache.get<DeadlineItem[]>(key);
      if (hasUsableItems(cached)) {
        items = cached;
      } else {
        const allAssignments = await scraper.getAllAssignmentDeadlines(courseId);
        const filtered = allAssignments.filter((it) => {
          const d = parseEClassDate(it.dueDate);
          if (!d) return false;
          return d >= fromDate && d <= toDate;
        });

        // Dedup by url if possible
        const seen = new Set<string>();
        items = filtered.filter((it) => {
          const k = it.url || it.id;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        cache.set(key, items, TTL.DEADLINES);
      }
    }

    if (includeDetails && items.length) {
      const n = Math.max(0, Math.min(items.length, maxDetails));
      const withDetails = await Promise.all(
        items.slice(0, n).map(async (it) => {
          try {
            const details = await getDetailsCached(it.url);
            return { ...it, details };
          } catch {
            return it;
          }
        })
      );
      items = [...withDetails, ...items.slice(n)];
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(items) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}

export async function getItemDetails(params: { url: string }) {
  try {
    const url = params?.url;
    if (!url) throw new Error('url is required');
    const details = await getDetailsCached(url);
    return { content: [{ type: 'text' as const, text: JSON.stringify(details) }] };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      openAuthWindow();
      return { content: [{ type: 'text' as const, text: e.message }] };
    }
    throw e;
  }
}
