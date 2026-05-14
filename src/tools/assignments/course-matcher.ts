import {
  resolveDashboardCourseSelection,
  type CengageDashboardCourse,
  type CengageCourseSelectionResult,
} from '../../scraper/cengage-courses';
import type { CoursePlatformEClassIdentity } from './platform-index';

export interface CengagePlatformSelectionInput {
  courseId?: string;
  courseKey?: string;
  courseQuery?: string;
}

export type CengageCourseMatchResult =
  | {
      status: 'selected';
      selectedCourse: CengageDashboardCourse;
      candidates: CengageDashboardCourse[];
      confidence: number;
      selectedBy: 'auto_match' | 'user_selection';
      message: string;
    }
  | {
      status: 'ambiguous';
      candidates: CengageDashboardCourse[];
      message: string;
    }
  | {
      status: 'not_found';
      candidates: CengageDashboardCourse[];
      message: string;
    };

export function compactCourseCode(value: string | undefined): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function spacedCourseCode(value: string | undefined): string {
  const compact = compactCourseCode(value);
  return compact.replace(/^([A-Z]{2,5})(\d{3,4}[A-Z]?)$/, '$1 $2');
}

function courseCodeCandidates(value: string | undefined): string[] {
  const raw = (value || '').toUpperCase();
  const matches = raw.match(/\b[A-Z]{2,5}\s?\d{3,4}[A-Z]?\b/g) || [];
  return Array.from(new Set(matches.map(compactCourseCode).filter(Boolean)));
}

function candidateContainsCourseCode(
  course: CengageDashboardCourse,
  targetCode: string
): boolean {
  const titleCodes = courseCodeCandidates(course.title);
  if (titleCodes.includes(targetCode)) return true;

  const compactTitle = compactCourseCode(course.title);
  if (compactTitle.includes(targetCode)) return true;

  const compactId = compactCourseCode(course.courseId);
  const compactKey = compactCourseCode(course.courseKey);
  return compactId.includes(targetCode) || compactKey.includes(targetCode);
}

function convertSelectionResult(
  result: CengageCourseSelectionResult,
  selectedBy: 'auto_match' | 'user_selection'
): CengageCourseMatchResult {
  if (result.status === 'selected' && result.selectedCourse) {
    return {
      status: 'selected',
      selectedCourse: result.selectedCourse,
      candidates: result.candidates,
      confidence: selectedBy === 'user_selection' ? 1 : 0.8,
      selectedBy,
      message: result.message,
    };
  }

  if (result.status === 'ambiguous' || result.status === 'selection_required') {
    return {
      status: 'ambiguous',
      candidates: result.candidates,
      message: result.message,
    };
  }

  return {
    status: 'not_found',
    candidates: result.candidates,
    message: result.message,
  };
}

export function resolveCengageCourseForEclass(params: {
  eclassCourse: CoursePlatformEClassIdentity;
  cengageCourses: CengageDashboardCourse[];
  selection?: CengagePlatformSelectionInput;
}): CengageCourseMatchResult {
  const { eclassCourse, cengageCourses, selection } = params;

  if (selection?.courseId || selection?.courseKey || selection?.courseQuery) {
    return convertSelectionResult(
      resolveDashboardCourseSelection(cengageCourses, selection),
      'user_selection'
    );
  }

  const targetCode = compactCourseCode(eclassCourse.courseCode);
  if (targetCode) {
    const codeMatches = cengageCourses.filter((course) =>
      candidateContainsCourseCode(course, targetCode)
    );

    if (codeMatches.length === 1) {
      return {
        status: 'selected',
        selectedCourse: codeMatches[0],
        candidates: codeMatches,
        confidence: 0.98,
        selectedBy: 'auto_match',
        message: `Selected Cengage/WebAssign course by exact course-code match '${targetCode}'.`,
      };
    }

    if (codeMatches.length > 1) {
      return {
        status: 'ambiguous',
        candidates: codeMatches,
        message:
          `Multiple Cengage/WebAssign courses matched eClass course code '${targetCode}'. ` +
          'A user selection is required before assignment extraction.',
      };
    }

    const spaced = spacedCourseCode(targetCode);
    const result = resolveDashboardCourseSelection(cengageCourses, {
      courseQuery: spaced,
    });
    const converted = convertSelectionResult(result, 'auto_match');
    if (converted.status !== 'not_found') {
      return converted;
    }
  }

  const courseName = (eclassCourse.courseName || '').trim();
  if (courseName) {
    const result = resolveDashboardCourseSelection(cengageCourses, {
      courseQuery: courseName,
    });
    return convertSelectionResult(result, 'auto_match');
  }

  return {
    status: 'not_found',
    candidates: cengageCourses,
    message: 'No Cengage/WebAssign course matched the eClass course identity.',
  };
}
