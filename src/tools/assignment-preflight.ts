import { getAuthUrl } from '../auth/server';
import { cache } from '../cache/store';
import { ValidationError } from '../errors/validation-error';
import type { Course, CourseContent } from '../scraper/eclass';
import { cengageCacheKey } from './cengage/cache';
import { normalizeAssignmentStatus } from './cengage/mappers';
import { CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY } from './cengage/service';
import { getCengageAssignments } from './cengage';
import {
  AssignmentSubmissionPreflightInputSchema,
  AssignmentSubmissionPreflightResponseSchema,
  type AssignmentSubmissionPreflightInput,
  type AssignmentSubmissionPreflightResponse,
} from './write-contracts';
import {
  createPreflightRef,
  computePreflightTargetHash,
} from './write-preflight-ref';
import { asValidatedMcpText } from './mcp-validated-response';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';
import { runEclassToolBoundary, type McpTextResponse } from './tool-boundary';
import { validateUrlForPolicy } from '../security/url-policy';
import { summarizeIntendedFiles } from './assignment-preflight-files';

type AssignmentCandidate = {
  name: string;
  url: string;
  courseId?: string;
  courseName?: string;
  courseCode?: string;
};

function response(payload: AssignmentSubmissionPreflightResponse) {
  return asValidatedMcpText(
    'prepare_assignment_submission',
    AssignmentSubmissionPreflightResponseSchema,
    payload
  );
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseFirstPayload(result: {
  content: Array<{ type: 'text'; text: string }>;
}): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function choosePlatform(
  args: AssignmentSubmissionPreflightInput
): 'eclass' | 'cengage' {
  if (args.platform === 'eclass' || args.platform === 'cengage') {
    return args.platform;
  }

  const urls = [args.entryUrl, args.ssoUrl, args.assignmentUrl]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  if (/cengage\.com|webassign\.net/i.test(urls) || args.courseKey) {
    return 'cengage';
  }
  return 'eclass';
}

function isNumericId(value: string | undefined): boolean {
  return !!value && /^\d+$/.test(value.trim());
}

function assignmentUrlFromId(assignmentId: string): string {
  return `https://eclass.yorku.ca/mod/assign/view.php?id=${encodeURIComponent(
    assignmentId.trim()
  )}`;
}

async function resolveCourse(
  args: AssignmentSubmissionPreflightInput,
  deps: ToolDependencies
): Promise<
  | { status: 'selected'; course: Course }
  | { status: 'ambiguous'; candidates: Course[]; message: string }
  | { status: 'not_found'; message: string }
> {
  if (args.courseId) {
    return {
      status: 'selected',
      course: {
        id: args.courseId,
        name: args.courseQuery || args.courseCode || args.courseId,
        courseCode: args.courseCode,
        url: `https://eclass.yorku.ca/course/view.php?id=${encodeURIComponent(
          args.courseId
        )}`,
      },
    };
  }

  const query = normalizeText(args.courseCode || args.courseQuery);
  if (!query) {
    return {
      status: 'not_found',
      message:
        'courseId, courseCode, or courseQuery is required when assignmentUrl/assignmentId is not provided.',
    };
  }

  const courses = await deps.eclassScraper.getCourses();
  const matches = courses.filter((course) => {
    const haystack = normalizeText(
      [course.id, course.name, course.courseCode].filter(Boolean).join(' ')
    );
    return haystack.includes(query);
  });

  if (matches.length === 1) {
    return { status: 'selected', course: matches[0] };
  }

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      candidates: matches,
      message:
        'Multiple eClass courses matched the provided course selector. Retry with courseId.',
    };
  }

  return {
    status: 'not_found',
    message: 'No eClass course matched the provided course selector.',
  };
}

function assignmentCandidatesFromContent(
  content: CourseContent,
  course?: Course
): AssignmentCandidate[] {
  return content.sections.flatMap((section) =>
    section.items
      .filter((item) => item.type === 'assign')
      .map((item) => ({
        name: item.name,
        url: item.url,
        courseId: content.courseId,
        courseName: course?.name,
        courseCode: course?.courseCode,
      }))
  );
}

async function resolveEClassAssignmentUrl(
  args: AssignmentSubmissionPreflightInput,
  deps: ToolDependencies
): Promise<
  | { status: 'selected'; url: string; course?: Course }
  | {
      status: 'ambiguous';
      message: string;
      candidates: AssignmentCandidate[] | Course[];
    }
  | { status: 'not_found'; message: string }
> {
  if (args.assignmentUrl) {
    const safeUrl = validateUrlForPolicy(args.assignmentUrl, 'eclass_item');
    return { status: 'selected', url: safeUrl };
  }

  if (isNumericId(args.assignmentId)) {
    return {
      status: 'selected',
      url: assignmentUrlFromId(args.assignmentId as string),
    };
  }

  const courseSelection = await resolveCourse(args, deps);
  if (courseSelection.status === 'ambiguous') {
    return courseSelection;
  }
  if (courseSelection.status === 'not_found') {
    return courseSelection;
  }

  const content = await deps.eclassScraper.getCourseContent(
    courseSelection.course.id
  );
  const candidates = assignmentCandidatesFromContent(
    content,
    courseSelection.course
  );
  const query = normalizeText(args.assignmentQuery || args.assignmentId);
  if (!query) {
    return {
      status: 'ambiguous',
      message:
        'An assignment selector is required when resolving from a course. Retry with assignmentUrl, assignmentId, or assignmentQuery.',
      candidates,
    };
  }

  const matches = candidates.filter((candidate) => {
    return normalizeText(candidate.name).includes(query);
  });

  if (matches.length === 1) {
    const match = matches[0];
    if (!match) {
      return {
        status: 'not_found',
        message:
          'No eClass assignment matched the provided assignment selector.',
      };
    }
    return {
      status: 'selected',
      url: validateUrlForPolicy(match.url, 'eclass_item'),
      course: courseSelection.course,
    };
  }

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      message:
        'Multiple eClass assignments matched the provided assignment selector. Retry with assignmentUrl.',
      candidates: matches,
    };
  }

  return {
    status: 'not_found',
    message: 'No eClass assignment matched the provided assignment selector.',
  };
}

function submissionMode(
  slots: NonNullable<AssignmentSubmissionPreflightResponse['uploadSlots']>
): AssignmentSubmissionPreflightResponse['submissionMode'] {
  const hasFile = slots.some((slot) => slot.kind === 'file');
  const hasText = slots.some((slot) => slot.kind === 'online_text');
  if (hasFile && hasText) return 'mixed';
  if (hasFile) return 'file_upload';
  if (hasText) return 'online_text';
  return 'none';
}

function withSignedRef(
  payload: AssignmentSubmissionPreflightResponse,
  targetFacts: Record<string, unknown>
): AssignmentSubmissionPreflightResponse {
  const targetHash = computePreflightTargetHash(targetFacts);
  const { ref, payload: refPayload } = createPreflightRef({ targetHash });
  return {
    ...payload,
    targetHash,
    preflightRef: ref,
    expiresAt: refPayload.expiresAt,
  };
}

async function prepareEClassSubmission(
  args: AssignmentSubmissionPreflightInput,
  intendedFiles: NonNullable<
    AssignmentSubmissionPreflightResponse['intendedFiles']
  >,
  deps: ToolDependencies
): Promise<AssignmentSubmissionPreflightResponse> {
  const resolved = await resolveEClassAssignmentUrl(args, deps);
  if (resolved.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      code: 'WRITE_TARGET_AMBIGUOUS',
      platform: 'eclass',
      message: resolved.message,
      candidates: resolved.candidates,
    };
  }
  if (resolved.status === 'not_found') {
    return {
      status: 'error',
      code: 'WRITE_PRECHECK_FAILED',
      platform: 'eclass',
      message: resolved.message,
    };
  }

  const details = await deps.eclassScraper.getAssignmentSubmissionPreflight(
    resolved.url
  );
  const uploadSlots = details.uploadSlots.map((slot) => ({
    ...slot,
  }));
  const fileSlot = uploadSlots.find((slot) => slot.kind === 'file');

  if (details.isFinalized && !details.canEditSubmission) {
    return {
      status: 'blocked',
      code: 'SUBMISSION_ALREADY_FINALIZED',
      platform: 'eclass',
      writeSupport: 'unsupported_assignment_state',
      submissionMode: submissionMode(uploadSlots),
      course: {
        id: details.courseId || resolved.course?.id,
        courseId: details.courseId || resolved.course?.id,
        courseCode: resolved.course?.courseCode,
        name: resolved.course?.name,
        url: resolved.course?.url,
      },
      assignment: {
        id: details.cmId,
        cmId: details.cmId,
        url: details.url,
        title: details.title,
        dueDate: details.dueDate,
        dueDateIso: details.dueDateIso,
        submissionState: details.submissionState,
      },
      uploadSlots,
      intendedFiles,
      blockers: [
        'The assignment appears already finalized and cannot be edited.',
      ],
    };
  }

  if (intendedFiles.length > 0 && (!fileSlot || fileSlot.canUpload === false)) {
    return {
      status: 'blocked',
      code: 'UPLOAD_SLOT_NOT_FOUND',
      platform: 'eclass',
      writeSupport: 'unsupported_assignment_state',
      submissionMode: submissionMode(uploadSlots),
      course: {
        id: details.courseId || resolved.course?.id,
        courseId: details.courseId || resolved.course?.id,
        courseCode: resolved.course?.courseCode,
        name: resolved.course?.name,
        url: resolved.course?.url,
      },
      assignment: {
        id: details.cmId,
        cmId: details.cmId,
        url: details.url,
        title: details.title,
        dueDate: details.dueDate,
        dueDateIso: details.dueDateIso,
        submissionState: details.submissionState,
      },
      uploadSlots,
      intendedFiles,
      blockers: [
        'No usable Moodle file upload slot was detected for the intended files.',
      ],
    };
  }

  const base: AssignmentSubmissionPreflightResponse = {
    status: 'ok',
    platform: 'eclass',
    writeSupport: 'supported',
    submissionMode: submissionMode(uploadSlots),
    course: {
      id: details.courseId || resolved.course?.id,
      courseId: details.courseId || resolved.course?.id,
      courseCode: resolved.course?.courseCode,
      name: resolved.course?.name,
      url: resolved.course?.url,
    },
    assignment: {
      id: details.cmId,
      cmId: details.cmId,
      url: details.url,
      title: details.title,
      dueDate: details.dueDate,
      dueDateIso: details.dueDateIso,
      submissionState: details.submissionState,
    },
    uploadSlots,
    intendedFiles,
    warnings: details.warnings,
  };

  return withSignedRef(base, {
    platform: 'eclass',
    course: base.course,
    assignment: base.assignment,
    uploadSlots: base.uploadSlots,
    intendedFiles,
  });
}

function selectCengageAssignment(
  assignments: Array<Record<string, unknown>>,
  args: AssignmentSubmissionPreflightInput
):
  | { status: 'selected'; assignment: Record<string, unknown> }
  | { status: 'ambiguous'; candidates: Array<Record<string, unknown>> }
  | { status: 'not_found' } {
  if (assignments.length === 0) return { status: 'not_found' };

  const byUrl = normalizeText(args.assignmentUrl);
  if (byUrl) {
    const matches = assignments.filter((assignment) =>
      normalizeText(String(assignment.url || '')).includes(byUrl)
    );
    if (matches.length === 1) {
      return { status: 'selected', assignment: matches[0] };
    }
    if (matches.length > 1) return { status: 'ambiguous', candidates: matches };
  }

  const byId = normalizeText(args.assignmentId);
  if (byId) {
    const matches = assignments.filter(
      (assignment) =>
        normalizeText(String(assignment.assignmentId || '')) === byId
    );
    if (matches.length === 1) {
      return { status: 'selected', assignment: matches[0] };
    }
    if (matches.length > 1) return { status: 'ambiguous', candidates: matches };
  }

  const byQuery = normalizeText(args.assignmentQuery);
  if (byQuery) {
    const matches = assignments.filter((assignment) =>
      normalizeText(String(assignment.name || '')).includes(byQuery)
    );
    if (matches.length === 1) {
      return { status: 'selected', assignment: matches[0] };
    }
    if (matches.length > 1) return { status: 'ambiguous', candidates: matches };
    return { status: 'not_found' };
  }

  if (assignments.length === 1) {
    return { status: 'selected', assignment: assignments[0] };
  }
  return { status: 'ambiguous', candidates: assignments };
}

async function prepareCengageSubmission(
  args: AssignmentSubmissionPreflightInput,
  intendedFiles: NonNullable<
    AssignmentSubmissionPreflightResponse['intendedFiles']
  >,
  deps: ToolDependencies
): Promise<AssignmentSubmissionPreflightResponse> {
  const entryUrl = (args.entryUrl || args.ssoUrl || '').trim() || undefined;
  cache.invalidate(
    cengageCacheKey('assignments', {
      entryUrl: entryUrl || CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY,
      courseId: args.courseId || null,
      courseKey: args.courseKey || null,
      courseQuery: args.courseQuery || null,
      allCourses: false,
      maxCourses: null,
      maxAssignmentsPerCourse: null,
    })
  );

  const result = await getCengageAssignments(
    {
      entryUrl: args.entryUrl,
      ssoUrl: args.ssoUrl,
      courseId: args.courseId,
      courseKey: args.courseKey,
      courseQuery: args.courseQuery,
    },
    deps
  );
  const payload = parseFirstPayload(result);

  if (payload.status === 'auth_required') {
    return {
      status: 'error',
      code: 'SESSION_EXPIRED',
      platform: 'cengage',
      message:
        typeof payload.message === 'string'
          ? payload.message
          : 'Cengage authentication is required.',
      retry:
        payload.retry && typeof payload.retry === 'object'
          ? (payload.retry as Record<string, unknown>)
          : { afterAuth: true, authUrl: getAuthUrl('cengage') },
    };
  }

  if (payload.status === 'needs_course_selection') {
    return {
      status: 'ambiguous',
      code: 'WRITE_TARGET_AMBIGUOUS',
      platform: 'cengage',
      message:
        typeof payload.message === 'string'
          ? payload.message
          : 'A Cengage/WebAssign course selection is required.',
      candidates: Array.isArray(payload.courses) ? payload.courses : undefined,
    };
  }

  if (payload.status === 'needs_course_activation') {
    return {
      status: 'blocked',
      code: 'COURSE_CONTEXT_MISMATCH',
      platform: 'cengage',
      message:
        typeof payload.message === 'string'
          ? payload.message
          : 'WebAssign opened a different active course.',
      course:
        payload.selectedCourse && typeof payload.selectedCourse === 'object'
          ? (payload.selectedCourse as Record<string, unknown>)
          : undefined,
      retry:
        payload.retry && typeof payload.retry === 'object'
          ? (payload.retry as Record<string, unknown>)
          : undefined,
      nextActions: Array.isArray(payload.nextActions)
        ? payload.nextActions.map(String)
        : undefined,
    };
  }

  if (payload.status === 'error') {
    return {
      status: 'error',
      code:
        typeof payload.code === 'string'
          ? (payload.code as AssignmentSubmissionPreflightResponse['code'])
          : 'WRITE_PRECHECK_FAILED',
      platform: 'cengage',
      message:
        typeof payload.message === 'string'
          ? payload.message
          : 'Cengage/WebAssign assignment preflight failed.',
      retry:
        payload.retry && typeof payload.retry === 'object'
          ? (payload.retry as Record<string, unknown>)
          : undefined,
    };
  }

  const assignments = Array.isArray(payload.assignments)
    ? (payload.assignments as Array<Record<string, unknown>>)
    : [];
  const selected = selectCengageAssignment(assignments, args);
  if (selected.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      code: 'WRITE_TARGET_AMBIGUOUS',
      platform: 'cengage',
      message:
        'Multiple Cengage/WebAssign assignments matched. Retry with assignmentId or assignmentUrl.',
      candidates: selected.candidates,
    };
  }
  if (selected.status === 'not_found') {
    return {
      status: 'error',
      code: 'WRITE_PRECHECK_FAILED',
      platform: 'cengage',
      message: 'No Cengage/WebAssign assignment matched the provided selector.',
      candidates: assignments,
    };
  }

  const assignment = selected.assignment;
  const course =
    payload.selectedCourse && typeof payload.selectedCourse === 'object'
      ? (payload.selectedCourse as Record<string, unknown>)
      : undefined;
  const status = normalizeAssignmentStatus(String(assignment.status || ''));
  const base: AssignmentSubmissionPreflightResponse = {
    status: 'ok',
    platform: 'cengage',
    writeSupport: 'unsupported_external_platform',
    submissionMode: 'external',
    course: course
      ? {
          id: String(course.courseId || ''),
          courseId: String(course.courseId || ''),
          courseCode: String(course.courseKey || ''),
          name: String(course.title || ''),
          url: String(course.launchUrl || ''),
        }
      : undefined,
    assignment: {
      id:
        typeof assignment.assignmentId === 'string'
          ? assignment.assignmentId
          : undefined,
      url:
        typeof assignment.url === 'string'
          ? assignment.url
          : args.assignmentUrl || '',
      title: String(assignment.name || 'WebAssign assignment'),
      dueDate:
        typeof assignment.dueDate === 'string' ? assignment.dueDate : undefined,
      dueDateIso:
        typeof assignment.dueDateIso === 'string'
          ? assignment.dueDateIso
          : undefined,
      submissionState: status,
    },
    uploadSlots: [],
    intendedFiles,
    warnings: [
      'Cengage/WebAssign assignment preflight is read-only. Moodle file upload is not supported for this external platform yet.',
    ],
    nextActions: [
      'Use this preflight for read-only target confirmation only; do not call Moodle submit_assignment for this assignment.',
    ],
  };

  return withSignedRef(base, {
    platform: 'cengage',
    course: base.course,
    assignment: base.assignment,
    uploadSlots: base.uploadSlots,
    intendedFiles,
    writeSupport: base.writeSupport,
  });
}

export async function prepareAssignmentSubmission(
  input: unknown,
  deps: ToolDependencies = createDefaultToolDependencies()
): Promise<McpTextResponse> {
  const run = async (): Promise<McpTextResponse> => {
    const parsed = AssignmentSubmissionPreflightInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError('Invalid assignment preflight input', {
        issues: parsed.error.issues,
      });
    }

    const args = parsed.data;
    const { summaries: intendedFiles, blockers } = await summarizeIntendedFiles(
      args.intendedFiles
    );
    if (blockers.length > 0) {
      return response({
        status: 'blocked',
        code: 'WRITE_PRECHECK_FAILED',
        message:
          'One or more intended local files could not be read for preflight.',
        intendedFiles,
        blockers,
      });
    }

    const platform = choosePlatform(args);
    const payload =
      platform === 'cengage'
        ? await prepareCengageSubmission(args, intendedFiles, deps)
        : await prepareEClassSubmission(args, intendedFiles, deps);
    return response(payload);
  };

  return runEclassToolBoundary({
    toolName: 'prepare_assignment_submission',
    run,
    onSessionExpired: {
      retry: run,
      fallback: (error) =>
        response({
          status: 'error',
          code: 'SESSION_EXPIRED',
          message: error.message,
          retry: { afterAuth: true, authUrl: getAuthUrl('eclass') },
        }),
    },
    onValidationError: (error) =>
      response({
        status: 'error',
        code: 'VALIDATION_FAILED',
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      }),
  });
}
