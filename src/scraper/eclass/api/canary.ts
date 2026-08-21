import type {
  Assignment,
  Course,
  CourseContent,
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
