import type {
  Announcement,
  Assignment,
  Course,
  CourseContent,
  DeadlineItem,
  Grade,
} from '../types';

/**
 * Shadow comparison of an API read against the Playwright read of the same
 * data. Only category names and counts leave this module, never values.
 *
 * A pass means every compared field was observed on both sides and was
 * equivalent after normalization. Duplicates count (multisets, not sets).
 * A date that cannot be parsed is reported as `*_unverified`, which fails
 * the comparison instead of being skipped.
 *
 * Dates are compared to the minute as instants. Playwright display dates
 * carry no zone and are read in the host's local zone, so the canary assumes
 * the host and the Moodle profile use the same time zone.
 */
export interface HybridCanaryComparison {
  passed: boolean;
  mismatchCategories: string[];
  apiCount: number;
  playwrightCount: number;
}

function comparison(
  mismatchCategories: string[],
  apiCount: number,
  playwrightCount: number
): HybridCanaryComparison {
  return {
    passed: mismatchCategories.length === 0,
    mismatchCategories: [...new Set(mismatchCategories)],
    apiCount,
    playwrightCount,
  };
}

function normalizedLabel(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Whitespace-insensitive text, for bodies rendered differently by source. */
function normalizedText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase();
}

function multiset(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function multisetMismatch(
  apiKeys: readonly string[],
  playwrightKeys: readonly string[]
): boolean {
  if (apiKeys.length !== playwrightKeys.length) return true;
  const api = multiset(apiKeys);
  const playwright = multiset(playwrightKeys);
  if (api.size !== playwright.size) return true;
  for (const [key, count] of api) {
    if (playwright.get(key) !== count) return true;
  }
  return false;
}

/**
 * Groups items by key, keeping order, so duplicates pair by occurrence
 * (the second "Quiz 1" is compared with the other side's second "Quiz 1").
 */
function pairByKey<T>(
  apiItems: readonly T[],
  playwrightItems: readonly T[],
  key: (item: T) => string
): Array<[T, T]> {
  const remaining = new Map<string, T[]>();
  for (const item of playwrightItems) {
    const list = remaining.get(key(item)) ?? [];
    list.push(item);
    remaining.set(key(item), list);
  }
  const pairs: Array<[T, T]> = [];
  for (const item of apiItems) {
    const match = remaining.get(key(item))?.shift();
    if (match !== undefined) pairs.push([item, match]);
  }
  return pairs;
}

const WEEKDAY_PREFIX = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Epoch milliseconds, or null when the value is not a readable date. */
export function canaryInstant(value: string | undefined): number | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const candidates = [
    raw,
    raw.replace(WEEKDAY_PREFIX, '').replace(/,/g, ' ').replace(/\s+/g, ' '),
  ];
  for (const candidate of candidates) {
    const time = Date.parse(candidate);
    if (!Number.isNaN(time)) return time;
  }
  return null;
}

/**
 * Pushes `<field>` on a different instant, `<field>_unverified` if either
 * side is unreadable. Two ISO timestamps must match exactly; a display date
 * (minute precision) is compared to the minute.
 */
function compareInstant(
  mismatches: string[],
  field: string,
  apiValue: string | undefined,
  playwrightValue: string | undefined
): void {
  if (!apiValue && !playwrightValue) return;
  const api = canaryInstant(apiValue);
  const playwright = canaryInstant(playwrightValue);
  if (api === null || playwright === null) {
    mismatches.push(`${field}_unverified`);
    return;
  }
  const exact =
    ISO_TIMESTAMP.test(apiValue!.trim()) &&
    ISO_TIMESTAMP.test(playwrightValue!.trim());
  const unit = exact ? 1 : 60_000;
  if (Math.floor(api / unit) !== Math.floor(playwright / unit)) {
    mismatches.push(field);
  }
}

function courseKey(course: Course): string {
  return `${course.id}|${normalizedLabel(course.name)}|${normalizedLabel(
    course.courseCode
  )}`;
}

export function compareCourseCanary(
  apiCourses: readonly Course[],
  playwrightCourses: readonly Course[]
): HybridCanaryComparison {
  const mismatches: string[] = [];
  if (apiCourses.length !== playwrightCourses.length) mismatches.push('count');
  if (
    multisetMismatch(
      apiCourses.map(courseKey),
      playwrightCourses.map(courseKey)
    )
  ) {
    mismatches.push('course_set');
  }
  return comparison(mismatches, apiCourses.length, playwrightCourses.length);
}

type ContentItem = CourseContent['sections'][number]['items'][number];

function itemKey(item: ContentItem): string {
  return `${item.type}|${normalizedLabel(item.name)}|${item.url}`;
}

function platformKeys(content: CourseContent): string[] {
  return (content.external_platforms ?? []).map(
    (platform) => `${normalizedLabel(platform.name)}|${platform.url}`
  );
}

export function compareCourseContentCanary(
  apiContent: CourseContent,
  playwrightContent: CourseContent
): HybridCanaryComparison {
  const apiItems = apiContent.sections.flatMap((section) => section.items);
  const playwrightItems = playwrightContent.sections.flatMap(
    (section) => section.items
  );
  const mismatches: string[] = [];
  if (apiContent.sections.length !== playwrightContent.sections.length) {
    mismatches.push('section_count');
  }
  const sectionCount = Math.min(
    apiContent.sections.length,
    playwrightContent.sections.length
  );
  for (let index = 0; index < sectionCount; index++) {
    const api = apiContent.sections[index]!;
    const playwright = playwrightContent.sections[index]!;
    if (normalizedLabel(api.title) !== normalizedLabel(playwright.title)) {
      mismatches.push('section_title');
    }
    if (
      multisetMismatch(api.items.map(itemKey), playwright.items.map(itemKey))
    ) {
      mismatches.push('section_membership');
    }
  }
  if (multisetMismatch(apiItems.map(itemKey), playwrightItems.map(itemKey))) {
    mismatches.push('visible_module_set');
  }
  if (
    multisetMismatch(platformKeys(apiContent), platformKeys(playwrightContent))
  ) {
    mismatches.push('external_platforms');
  }
  return comparison(mismatches, apiItems.length, playwrightItems.length);
}

export function compareDeadlineCanary(
  apiAssignments: readonly Assignment[],
  playwrightAssignments: readonly Assignment[]
): HybridCanaryComparison {
  const mismatches: string[] = [];
  if (apiAssignments.length !== playwrightAssignments.length) {
    mismatches.push('count');
  }
  const id = (item: Assignment) => item.id;
  if (multisetMismatch(apiAssignments.map(id), playwrightAssignments.map(id))) {
    mismatches.push('deadline_set');
  }
  for (const [api, playwright] of pairByKey(
    apiAssignments,
    playwrightAssignments,
    id
  )) {
    if (normalizedLabel(api.name) !== normalizedLabel(playwright.name)) {
      mismatches.push('name');
    }
    if (api.courseId !== playwright.courseId) mismatches.push('course');
    compareInstant(mismatches, 'due_date', api.dueDate, playwright.dueDate);
  }
  return comparison(
    mismatches,
    apiAssignments.length,
    playwrightAssignments.length
  );
}

export function assertCanaryPassed(
  comparisonResult: HybridCanaryComparison,
  label: string
): void {
  if (comparisonResult.passed) return;
  throw new Error(
    `${label} canary failed: ${comparisonResult.mismatchCategories.join(',')}`
  );
}

export function compareGradeCanary(
  apiGrades: readonly Grade[],
  playwrightGrades: readonly Grade[]
): HybridCanaryComparison {
  const key = (grade: Grade) =>
    `${grade.courseId}|${normalizedLabel(grade.itemName)}`;
  const mismatches: string[] = [];
  if (apiGrades.length !== playwrightGrades.length) mismatches.push('count');
  if (multisetMismatch(apiGrades.map(key), playwrightGrades.map(key))) {
    mismatches.push('grade_item_set');
  }
  const fields = [
    ['grade', 'grade_value'],
    ['range', 'grade_range'],
    ['percentage', 'grade_percentage'],
  ] as const;
  for (const [api, playwright] of pairByKey(apiGrades, playwrightGrades, key)) {
    for (const [field, category] of fields) {
      if (normalizedLabel(api[field]) !== normalizedLabel(playwright[field])) {
        mismatches.push(category);
      }
    }
    if (normalizedText(api.feedback) !== normalizedText(playwright.feedback)) {
      mismatches.push('grade_feedback');
    }
  }
  return comparison(mismatches, apiGrades.length, playwrightGrades.length);
}

function linkKeys(announcement: Announcement): string[] {
  return announcement.links.map((link) => link.url);
}

export function compareAnnouncementCanary(
  apiAnnouncements: readonly Announcement[],
  playwrightAnnouncements: readonly Announcement[]
): HybridCanaryComparison {
  const mismatches: string[] = [];
  if (apiAnnouncements.length !== playwrightAnnouncements.length) {
    mismatches.push('count');
  }
  const id = (item: Announcement) => item.id;
  if (
    multisetMismatch(apiAnnouncements.map(id), playwrightAnnouncements.map(id))
  ) {
    mismatches.push('discussion_set');
  }
  for (const [api, playwright] of pairByKey(
    apiAnnouncements,
    playwrightAnnouncements,
    id
  )) {
    if (normalizedLabel(api.title) !== normalizedLabel(playwright.title)) {
      mismatches.push('title_mismatch');
    }
    if (normalizedText(api.content) !== normalizedText(playwright.content)) {
      mismatches.push('content_mismatch');
    }
    if (normalizedLabel(api.author) !== normalizedLabel(playwright.author)) {
      mismatches.push('author_mismatch');
    }
    if (multisetMismatch(linkKeys(api), linkKeys(playwright))) {
      mismatches.push('links_mismatch');
    }
    compareInstant(mismatches, 'date_mismatch', api.date, playwright.date);
  }
  return comparison(
    mismatches,
    apiAnnouncements.length,
    playwrightAnnouncements.length
  );
}

export function compareAssignmentIndexCanary(
  apiItems: readonly DeadlineItem[],
  playwrightItems: readonly DeadlineItem[]
): HybridCanaryComparison {
  const mismatches: string[] = [];
  if (apiItems.length !== playwrightItems.length) mismatches.push('count');
  const id = (item: DeadlineItem) => item.id;
  if (multisetMismatch(apiItems.map(id), playwrightItems.map(id))) {
    mismatches.push('assignment_set');
  }
  for (const [api, playwright] of pairByKey(apiItems, playwrightItems, id)) {
    if (normalizedLabel(api.status) !== normalizedLabel(playwright.status)) {
      mismatches.push('submission_status');
    }
    if (
      normalizedLabel(api.submission) !== normalizedLabel(playwright.submission)
    ) {
      mismatches.push('submission_state');
    }
    if (normalizedLabel(api.name) !== normalizedLabel(playwright.name)) {
      mismatches.push('name');
    }
    compareInstant(mismatches, 'due_date', api.dueDate, playwright.dueDate);
  }
  return comparison(mismatches, apiItems.length, playwrightItems.length);
}
