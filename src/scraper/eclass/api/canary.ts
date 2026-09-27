import type {
  Announcement,
  Assignment,
  Course,
  CourseContent,
  DeadlineItem,
  Grade,
} from '../types';

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

function courseKey(course: Course): string {
  return `${course.id}|${course.name.trim()}|${course.courseCode || ''}`;
}

export function compareCourseCanary(
  apiCourses: readonly Course[],
  playwrightCourses: readonly Course[]
): HybridCanaryComparison {
  const apiSet = new Set(apiCourses.map(courseKey));
  const playwrightSet = new Set(playwrightCourses.map(courseKey));
  const mismatches: string[] = [];
  if (apiSet.size !== playwrightSet.size) mismatches.push('count');
  if (
    [...apiSet].some((course) => !playwrightSet.has(course)) ||
    [...playwrightSet].some((course) => !apiSet.has(course))
  ) {
    mismatches.push('course_set');
  }
  return comparison(mismatches, apiCourses.length, playwrightCourses.length);
}

export function compareCourseContentCanary(
  apiContent: CourseContent,
  playwrightContent: CourseContent
): HybridCanaryComparison {
  const apiItems = apiContent.sections.flatMap((section) => section.items);
  const playwrightItems = playwrightContent.sections.flatMap(
    (section) => section.items
  );
  const apiSet = new Set(
    apiItems.map((item) => `${item.type}|${item.name.trim()}|${item.url}`)
  );
  const playwrightSet = new Set(
    playwrightItems.map(
      (item) => `${item.type}|${item.name.trim()}|${item.url}`
    )
  );
  const mismatches: string[] = [];
  if (apiContent.sections.length !== playwrightContent.sections.length) {
    mismatches.push('section_count');
  }
  if (
    [...apiSet].some((item) => !playwrightSet.has(item)) ||
    [...playwrightSet].some((item) => !apiSet.has(item))
  ) {
    mismatches.push('visible_module_set');
  }
  return comparison(mismatches, apiItems.length, playwrightItems.length);
}

export function compareDeadlineCanary(
  apiAssignments: readonly Assignment[],
  playwrightAssignments: readonly Assignment[]
): HybridCanaryComparison {
  const apiById = new Map(apiAssignments.map((item) => [item.id, item]));
  const playwrightById = new Map(
    playwrightAssignments.map((item) => [item.id, item])
  );
  const mismatches: string[] = [];
  if (apiById.size !== playwrightById.size) mismatches.push('count');
  for (const [id, apiItem] of apiById) {
    const playwrightItem = playwrightById.get(id);
    if (!playwrightItem) {
      mismatches.push('missing_deadline');
      continue;
    }
    if (apiItem.dueDate !== playwrightItem.dueDate) {
      mismatches.push('timestamp_mismatch');
    }
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

function setMismatch(
  apiKeys: ReadonlySet<string>,
  playwrightKeys: ReadonlySet<string>
): boolean {
  return (
    [...apiKeys].some((key) => !playwrightKeys.has(key)) ||
    [...playwrightKeys].some((key) => !apiKeys.has(key))
  );
}

function normalizedLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function compareGradeCanary(
  apiGrades: readonly Grade[],
  playwrightGrades: readonly Grade[]
): HybridCanaryComparison {
  const key = (grade: Grade) =>
    `${grade.courseId}|${normalizedLabel(grade.itemName)}`;
  const apiByKey = new Map(apiGrades.map((grade) => [key(grade), grade]));
  const playwrightByKey = new Map(
    playwrightGrades.map((grade) => [key(grade), grade])
  );
  const mismatches: string[] = [];
  if (apiByKey.size !== playwrightByKey.size) mismatches.push('count');
  if (setMismatch(new Set(apiByKey.keys()), new Set(playwrightByKey.keys()))) {
    mismatches.push('grade_item_set');
  }
  for (const [itemKey, apiGrade] of apiByKey) {
    const playwrightGrade = playwrightByKey.get(itemKey);
    if (
      playwrightGrade &&
      normalizedLabel(apiGrade.grade) !== normalizedLabel(playwrightGrade.grade)
    ) {
      mismatches.push('grade_value');
    }
  }
  return comparison(mismatches, apiGrades.length, playwrightGrades.length);
}

export function compareAnnouncementCanary(
  apiAnnouncements: readonly Announcement[],
  playwrightAnnouncements: readonly Announcement[]
): HybridCanaryComparison {
  const ids = (items: readonly Announcement[]) =>
    new Set(items.map((item) => item.id));
  const titles = (items: readonly Announcement[]) =>
    new Set(items.map((item) => `${item.id}|${normalizedLabel(item.title)}`));
  const mismatches: string[] = [];
  if (apiAnnouncements.length !== playwrightAnnouncements.length) {
    mismatches.push('count');
  }
  if (setMismatch(ids(apiAnnouncements), ids(playwrightAnnouncements))) {
    mismatches.push('discussion_set');
  } else if (
    setMismatch(titles(apiAnnouncements), titles(playwrightAnnouncements))
  ) {
    mismatches.push('title_mismatch');
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
  const apiById = new Map(apiItems.map((item) => [item.id, item]));
  const playwrightById = new Map(
    playwrightItems.map((item) => [item.id, item])
  );
  const mismatches: string[] = [];
  if (apiById.size !== playwrightById.size) mismatches.push('count');
  if (setMismatch(new Set(apiById.keys()), new Set(playwrightById.keys()))) {
    mismatches.push('assignment_set');
  }
  for (const [id, apiItem] of apiById) {
    const playwrightItem = playwrightById.get(id);
    if (
      playwrightItem &&
      normalizedLabel(apiItem.status) !== normalizedLabel(playwrightItem.status)
    ) {
      mismatches.push('submission_status');
    }
  }
  return comparison(mismatches, apiItems.length, playwrightItems.length);
}
