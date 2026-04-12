import type { CengageDashboardCourse } from '../../scraper/cengage-courses';
import { CengageAuthRequiredError } from '../../scraper/cengage-errors';
import type {
  GetCengageAssignmentDetailsInput,
  GetCengageAssignmentsInput,
  ListCengageCoursesInput,
} from '../cengage-contracts';

export function normalizeAssignmentStatus(
  rawStatus: string
): 'pending' | 'submitted' | 'graded' | 'unknown' {
  const normalized = rawStatus.toLowerCase();
  if (normalized.includes('submitted')) return 'submitted';
  if (normalized.includes('graded')) return 'graded';
  if (normalized.includes('pending')) return 'pending';
  return 'unknown';
}

export function resolveListingEntryUrl(
  input: ListCengageCoursesInput
): string | undefined {
  if (input.discoveredLink?.normalizedUrl) {
    return input.discoveredLink.normalizedUrl;
  }

  if (input.discoveredLink?.rawUrl) {
    return input.discoveredLink.rawUrl;
  }

  const entryUrl = (input.entryUrl || '').trim();
  return entryUrl || undefined;
}

export function mapCourseSummary(course: CengageDashboardCourse) {
  return {
    courseId: course.courseId,
    courseKey: course.courseKey,
    title: course.title,
    launchUrl: course.launchUrl,
    platform: course.platform,
    confidence: course.confidence,
  };
}

export function toRetryInputRecord(input: Record<string, unknown>) {
  const trimmedEntries = Object.entries(input).filter(
    ([, value]) => value !== undefined && value !== null && value !== ''
  );
  return Object.fromEntries(trimmedEntries);
}

export function mapAuthReason(
  error: CengageAuthRequiredError
): 'session_missing' | 'session_stale' | 'login_required' | 'auth_required' {
  const details = error.details || {};

  if (details.sessionReason === 'stale') {
    return 'session_stale';
  }

  if (
    details.sessionReason === 'missing' ||
    details.sessionReason === 'invalid'
  ) {
    return 'session_missing';
  }

  const pageState =
    typeof details.pageState === 'object' && details.pageState !== null
      ? (details.pageState as Record<string, unknown>)
      : undefined;

  if (pageState?.state === 'login') {
    return 'login_required';
  }

  return 'auth_required';
}

export function summarizeCourseCandidates(
  candidates: CengageDashboardCourse[]
): string {
  return candidates
    .slice(0, 5)
    .map((course) => {
      const idParts = [course.courseId, course.courseKey].filter(Boolean);
      const suffix = idParts.length > 0 ? ` [${idParts.join(' | ')}]` : '';
      return `${course.title}${suffix}`;
    })
    .join('; ');
}

export function resolveAssignmentsInput(
  input: GetCengageAssignmentsInput | string
): GetCengageAssignmentsInput {
  if (typeof input === 'string') {
    return { ssoUrl: input };
  }

  return input;
}

export function resolveAssignmentDetailsInput(
  input: GetCengageAssignmentDetailsInput | string
): GetCengageAssignmentDetailsInput {
  if (typeof input === 'string') {
    return { ssoUrl: input };
  }

  return input;
}
