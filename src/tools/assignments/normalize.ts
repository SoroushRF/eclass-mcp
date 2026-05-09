import type { WebAssignAssignment } from '../../scraper/cengage';
import type { CengageDashboardCourse } from '../../scraper/cengage-courses';
import type { DeadlineItem } from '../../types/deadlines';
import { parseEClassDate, type DeadlineScope } from '../eclass-service';

export type NormalizedAssignmentPlatform =
  | 'eclass'
  | 'webassign'
  | 'cengage';

export interface NormalizedAssignment {
  [key: string]: unknown;
  platform: NormalizedAssignmentPlatform;
  sourceTool: 'get_deadlines' | 'get_cengage_assignments';
  id?: string;
  assignmentId?: string;
  name: string;
  dueDate?: string;
  dueDateIso?: string;
  status?: string;
  score?: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  courseTitle?: string;
  url?: string;
  type?: 'assign' | 'quiz' | 'other';
  rawText?: string;
  dateParseStatus?: 'ok' | 'unknown';
}

export function normalizeEclassAssignment(
  item: DeadlineItem
): NormalizedAssignment {
  const parsed = parseEClassDate(item.dueDate);
  return {
    platform: 'eclass',
    sourceTool: 'get_deadlines',
    id: item.id,
    name: item.name,
    dueDate: item.dueDate,
    dueDateIso: parsed?.toISOString(),
    status: item.status,
    courseId: item.courseId,
    courseCode: item.courseCode,
    courseName: item.courseName,
    url: item.url,
    type: item.type,
    dateParseStatus: parsed ? 'ok' : 'unknown',
  };
}

export function normalizeCengageAssignment(
  item: WebAssignAssignment,
  course: CengageDashboardCourse
): NormalizedAssignment {
  const platform = course.platform || 'webassign';
  const parsed = parseAssignmentDate(item.dueDateIso || item.dueDate);
  return {
    platform,
    sourceTool: 'get_cengage_assignments',
    assignmentId: item.id,
    name: item.name,
    dueDate: item.dueDate,
    dueDateIso: item.dueDateIso || parsed?.toISOString(),
    status: item.status,
    score: item.score,
    courseId: item.courseId || course.courseId,
    courseTitle: item.courseTitle || course.title,
    url: item.url,
    rawText: item.rawText,
    dateParseStatus: item.dueDateIso || parsed ? 'ok' : 'unknown',
  };
}

function parseAssignmentDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return parseEClassDate(value);
}

function dateForSort(item: NormalizedAssignment): number {
  const parsed = parseAssignmentDate(item.dueDateIso || item.dueDate);
  return parsed?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

export function filterAssignmentsByScope(
  items: NormalizedAssignment[],
  params: {
    scope?: DeadlineScope;
    month?: number;
    year?: number;
    from?: string;
    to?: string;
  }
): NormalizedAssignment[] {
  const scope = params.scope || 'upcoming';
  if (scope === 'upcoming') {
    return items;
  }

  if (scope === 'month') {
    const month = params.month ?? new Date().getMonth() + 1;
    const year = params.year ?? new Date().getFullYear();
    return items.filter((item) => {
      const parsed = parseAssignmentDate(item.dueDateIso || item.dueDate);
      if (!parsed) return false;
      return parsed.getMonth() + 1 === month && parsed.getFullYear() === year;
    });
  }

  if (!params.from || !params.to) {
    return items;
  }

  const fromDate = new Date(params.from);
  const toDate = new Date(params.to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.from.trim())) {
    fromDate.setHours(0, 0, 0, 0);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.to.trim())) {
    toDate.setHours(23, 59, 59, 999);
  }

  return items.filter((item) => {
    const parsed = parseAssignmentDate(item.dueDateIso || item.dueDate);
    if (!parsed) return false;
    return parsed >= fromDate && parsed <= toDate;
  });
}

export function sortAssignments(
  items: NormalizedAssignment[]
): NormalizedAssignment[] {
  return [...items].sort((a, b) => {
    const dateDiff = dateForSort(a) - dateForSort(b);
    if (dateDiff !== 0) return dateDiff;

    const platformOrder = a.platform.localeCompare(b.platform);
    if (platformOrder !== 0) return platformOrder;

    return a.name.localeCompare(b.name);
  });
}
