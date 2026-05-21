import {
  getAuthUrl,
  openAuthWindow,
  waitForCengageAuthSession,
} from '../auth/server';
import { SessionExpiredError, type Course } from '../scraper/eclass';
import { ScrapeLayoutError } from '../scraper/scrape-errors';
import type { CengageDashboardCourse } from '../scraper/cengage-courses';
import {
  CengageAuthRequiredError,
  CengageCourseActivationError,
  CengageError,
} from '../scraper/cengage-errors';
import { getCengageSessionValidity } from '../scraper/cengage-session';
import { ValidationError } from '../errors/validation-error';
import { toErrorPayload } from '../errors/tool-error';
import { SecureSessionStorageError } from '../security/secure-session-store';
import { asValidatedMcpText } from './mcp-validated-response';
import { handleEclassSessionExpired } from './auth-retry';
import type { McpTextResponse } from './tool-boundary';
import {
  AssignmentResolverResponseSchema,
  type AssignmentResolverResponse,
  type GetAssignmentsInput,
} from './assignment-contracts';
import {
  getEclassCoursesWithCache,
  getEclassDeadlineItems,
} from './eclass-service';
import {
  getCengageAssignmentsForCourse,
  getCengageDashboardInventory,
  isCengageCourseContextMismatch,
} from './cengage/service';
import { mapCourseSummary } from './cengage/mappers';
import {
  compactCourseCode,
  resolveCengageCourseForEclass,
  type CengageCourseMatchResult,
} from './assignments/course-matcher';
import {
  filterAssignmentsByScope,
  normalizeCengageAssignment,
  normalizeEclassAssignment,
  sortAssignments,
  type NormalizedAssignment,
} from './assignments/normalize';
import {
  getCoursePlatformRecord,
  recordCengageAmbiguous,
  recordCengageAuthRequired,
  recordCengageNotFound,
  upsertCoursePlatformMapping,
  type CoursePlatformEClassIdentity,
  type CoursePlatformRecord,
} from './assignments/platform-index';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

interface CourseResolution {
  status: 'all' | 'selected' | 'ambiguous' | 'not_found';
  course?: Course;
  syntheticCourse?: CoursePlatformEClassIdentity;
  candidates?: Course[];
  message?: string;
}

interface SourceState {
  eclass: AssignmentResolverResponse['sources']['eclass'];
  cengage: AssignmentResolverResponse['sources']['cengage'];
}

const DEFAULT_CENGAGE_ALL_COURSES_LIMIT = 5;

function assignmentResponse(payload: AssignmentResolverResponse) {
  return asValidatedMcpText(
    'get_assignments',
    AssignmentResolverResponseSchema,
    payload
  );
}

function supportsWebAssignAssignments(course: CengageDashboardCourse): boolean {
  return course.platform === 'webassign';
}

function unsupportedAssignmentPlatformMessage(
  course: CengageDashboardCourse
): string {
  const platform =
    course.platform === 'owlv2'
      ? 'OWLv2/CengageNOW'
      : course.platform === 'cengage'
        ? 'Cengage'
        : course.platform;

  return (
    `${course.title} is visible on the Cengage dashboard, but its launch platform is ${platform}. ` +
    'Assignment extraction is currently WebAssign-only, so this course is reported as visible but unsupported for assignment scraping.'
  );
}

function defaultSources(): SourceState {
  return {
    eclass: {
      checked: false,
      status: 'not_checked',
      assignmentCount: 0,
    },
    cengage: {
      checked: false,
      status: 'not_checked',
      assignmentCount: 0,
    },
  };
}

function courseToResponse(course: Course | undefined) {
  if (!course) return undefined;
  return {
    id: course.id,
    name: course.name,
    courseCode: course.courseCode,
    url: course.url,
  };
}

function courseToIdentity(
  course: Course | undefined,
  fallback?: CoursePlatformEClassIdentity
): CoursePlatformEClassIdentity {
  return {
    courseId: course?.id || fallback?.courseId,
    courseName: course?.name || fallback?.courseName,
    courseCode: course?.courseCode || fallback?.courseCode,
    url: course?.url || fallback?.url,
  };
}

function resolveTargetCourse(
  args: GetAssignmentsInput,
  courses: Course[]
): CourseResolution {
  if (args.courseId) {
    const match = courses.find((course) => course.id === args.courseId);
    if (match) return { status: 'selected', course: match };
    return {
      status: 'selected',
      syntheticCourse: {
        courseId: args.courseId,
        courseName: args.courseId,
      },
    };
  }

  if (args.courseCode) {
    const targetCode = compactCourseCode(args.courseCode);
    const matches = courses.filter(
      (course) => compactCourseCode(course.courseCode) === targetCode
    );
    if (matches.length === 1) {
      return { status: 'selected', course: matches[0] };
    }
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        candidates: matches,
        message:
          `Multiple eClass courses matched courseCode '${args.courseCode}'. ` +
          'Provide courseId to choose one.',
      };
    }
    return {
      status: 'not_found',
      syntheticCourse: {
        courseCode: args.courseCode,
        courseName: args.courseCode,
      },
      message:
        `No eClass course matched courseCode '${args.courseCode}'. ` +
        'Cengage/WebAssign will still be checked when external lookup is enabled.',
    };
  }

  if (args.courseQuery) {
    const query = args.courseQuery.trim().toLowerCase();
    const matches = courses.filter((course) => {
      const haystack = [course.name, course.courseCode, course.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
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
          `Multiple eClass courses matched courseQuery '${args.courseQuery}'. ` +
          'Provide courseId or courseCode to choose one.',
      };
    }
    return {
      status: 'not_found',
      syntheticCourse: {
        courseName: args.courseQuery,
        courseCode: compactCourseCode(args.courseQuery) || undefined,
      },
      message:
        `No eClass course matched courseQuery '${args.courseQuery}'. ` +
        'Cengage/WebAssign will still be checked when external lookup is enabled.',
    };
  }

  return { status: 'all' };
}

function mappingToDashboardCourse(
  record: CoursePlatformRecord | undefined
): CengageDashboardCourse | undefined {
  const mapping = record?.platforms.cengage;
  if (!mapping || mapping.status !== 'linked' || !mapping.launchUrl) {
    return undefined;
  }

  return {
    courseId: mapping.courseId,
    courseKey: mapping.courseKey,
    title:
      mapping.title ||
      mapping.courseKey ||
      mapping.courseId ||
      'Cengage Course',
    launchUrl: mapping.launchUrl,
    platform: mapping.platform || 'webassign',
    assignmentsSupported: mapping.assignmentsSupported,
    confidence: mapping.confidence || 1,
  };
}

function cengageCandidatesForResponse(candidates: CengageDashboardCourse[]) {
  return candidates.slice(0, 10).map(mapCourseSummary);
}

function authRequiredResponse(params: {
  args: GetAssignmentsInput;
  sources: SourceState;
  assignments: NormalizedAssignment[];
  course?: Course;
  record?: CoursePlatformRecord;
  indexUpdated?: boolean;
}): AssignmentResolverResponse {
  const authUrl = getAuthUrl('cengage');
  const hasAssignments = params.assignments.length > 0;
  return {
    status: hasAssignments ? 'partial' : 'needs_external_auth',
    code: 'SESSION_EXPIRED',
    course: courseToResponse(params.course),
    assignments: sortAssignments(params.assignments),
    sources: {
      ...params.sources,
      cengage: {
        ...params.sources.cengage,
        checked: false,
        status: 'auth_required',
        assignmentCount: 0,
        authUrl,
      },
    },
    platformIndex: {
      ...indexSummaryForResponse(params.record),
      updated: params.indexUpdated,
    },
    message:
      'Cengage/WebAssign authentication is required before this assignment answer can be considered complete.',
    retry: {
      afterAuth: true,
      authUrl,
      input: params.args as Record<string, unknown>,
    },
    nextActions: [
      'Complete Cengage/WebAssign login in the browser window, then retry get_assignments with the same input.',
    ],
  };
}

function activationRequiredResponse(params: {
  args: GetAssignmentsInput;
  sources: SourceState;
  assignments: NormalizedAssignment[];
  course?: Course;
  record?: CoursePlatformRecord;
  indexUpdated?: boolean;
  error: CengageCourseActivationError;
}): AssignmentResolverResponse {
  const sorted = sortAssignments(params.assignments);
  return {
    status: sorted.length > 0 ? 'partial' : 'needs_course_activation',
    code: 'COURSE_CONTEXT_MISMATCH',
    course: courseToResponse(params.course),
    assignments: sorted,
    sources: {
      ...params.sources,
      cengage: {
        ...params.sources.cengage,
        checked: true,
        status: 'needs_course_activation',
        assignmentCount: 0,
      },
    },
    platformIndex: {
      ...indexSummaryForResponse(params.record),
      updated: params.indexUpdated,
    },
    message:
      'WebAssign opened a different active course than the selected Cengage course.',
    retry: {
      afterAuth: false,
      reason: 'course_activation_required',
      input: params.args as Record<string, unknown>,
    },
    nextActions: [
      'Open Cengage dashboard and launch the intended WebAssign course, then retry get_assignments.',
      'If the problem persists, call get_cengage_assignments with allCourses=true to inspect available active contexts.',
    ],
    diagnostics: params.error.details,
  };
}

async function fetchCengageAllCourses(params: {
  args: GetAssignmentsInput;
  sources: SourceState;
  assignments: NormalizedAssignment[];
  deps: ToolDependencies;
}): Promise<void> {
  const scraper = params.deps.createCengageScraper();
  try {
    const courses = await getCengageDashboardInventory({ scraper });
    const selectedCourses = courses.slice(0, DEFAULT_CENGAGE_ALL_COURSES_LIMIT);
    let cengageCount = 0;

    for (const course of selectedCourses) {
      if (!supportsWebAssignAssignments(course)) {
        continue;
      }

      const { assignments } = await getCengageAssignmentsForCourse(course, {
        scraper,
      });
      const normalized = assignments.map((item) =>
        normalizeCengageAssignment(item, course)
      );
      params.assignments.push(
        ...filterAssignmentsByScope(normalized, {
          scope: params.args.scope,
          month: params.args.month,
          year: params.args.year,
          from: params.args.from,
          to: params.args.to,
        })
      );
      cengageCount += assignments.length;
    }

    params.sources.cengage = {
      checked: true,
      status: cengageCount > 0 ? 'ok' : 'no_data',
      assignmentCount: cengageCount,
    };
  } finally {
    await scraper.close();
  }
}

async function fetchCengageForCourse(params: {
  args: GetAssignmentsInput;
  eclassIdentity: CoursePlatformEClassIdentity;
  record?: CoursePlatformRecord;
  sources: SourceState;
  assignments: NormalizedAssignment[];
  refreshPlatformIndex: boolean;
  deps: ToolDependencies;
}): Promise<{
  record?: CoursePlatformRecord;
  indexUpdated: boolean;
  match?: CengageCourseMatchResult;
}> {
  const scraper = params.deps.createCengageScraper();
  let indexUpdated = false;
  let record = params.record;

  try {
    let selectedCourse =
      !params.refreshPlatformIndex && !params.args.platformSelection?.cengage
        ? mappingToDashboardCourse(record)
        : undefined;
    let match: CengageCourseMatchResult | undefined;

    if (!selectedCourse) {
      const courses = await getCengageDashboardInventory({ scraper });
      match = resolveCengageCourseForEclass({
        eclassCourse: params.eclassIdentity,
        cengageCourses: courses,
        selection: params.args.platformSelection?.cengage,
      });

      if (match.status === 'ambiguous') {
        record = recordCengageAmbiguous(
          params.eclassIdentity,
          cengageCandidatesForResponse(match.candidates)
        );
        params.sources.cengage = {
          checked: true,
          status: 'needs_course_selection',
          assignmentCount: 0,
          candidates: cengageCandidatesForResponse(match.candidates),
        };
        return { record, indexUpdated: true, match };
      }

      if (match.status === 'not_found') {
        record = recordCengageNotFound(params.eclassIdentity, {
          message: match.message,
        });
        params.sources.cengage = {
          checked: true,
          status: 'no_matching_course',
          assignmentCount: 0,
        };
        return { record, indexUpdated: true, match };
      }

      selectedCourse = match.selectedCourse;
      record = upsertCoursePlatformMapping({
        eclass: params.eclassIdentity,
        cengage: {
          status: 'linked',
          ...mapCourseSummary(selectedCourse),
          selectedBy: match.selectedBy,
          confidence: match.confidence,
          matchedAt: new Date().toISOString(),
        },
      });
      indexUpdated = true;
    }

    if (!supportsWebAssignAssignments(selectedCourse)) {
      params.sources.cengage = {
        checked: true,
        status: 'unsupported_platform',
        assignmentCount: 0,
        selectedCourse: mapCourseSummary(selectedCourse),
      };

      if (record?.platforms.cengage?.status === 'linked') {
        record = upsertCoursePlatformMapping({
          eclass: params.eclassIdentity,
          cengage: {
            ...record.platforms.cengage,
            ...mapCourseSummary(selectedCourse),
            status: 'linked',
            lastCheckedAt: new Date().toISOString(),
            diagnostics: {
              unsupportedPlatform: selectedCourse.platform,
              message: unsupportedAssignmentPlatformMessage(selectedCourse),
            },
          },
        });
        indexUpdated = true;
      }

      return { record, indexUpdated, match };
    }

    const result = await getCengageAssignmentsForCourse(selectedCourse, {
      scraper,
      expectedCourseTitle: params.eclassIdentity.courseName,
      expectedCourseCode: params.eclassIdentity.courseCode,
    });
    const cengageAssignments = filterAssignmentsByScope(
      result.assignments.map((item) =>
        normalizeCengageAssignment(item, result.selectedCourse)
      ),
      {
        scope: params.args.scope,
        month: params.args.month,
        year: params.args.year,
        from: params.args.from,
        to: params.args.to,
      }
    );

    params.assignments.push(...cengageAssignments);
    params.sources.cengage = {
      checked: true,
      status: cengageAssignments.length > 0 ? 'ok' : 'no_data',
      assignmentCount: cengageAssignments.length,
      selectedCourse: mapCourseSummary(result.selectedCourse),
    };

    if (record?.platforms.cengage?.status === 'linked') {
      record = upsertCoursePlatformMapping({
        eclass: params.eclassIdentity,
        cengage: {
          ...record.platforms.cengage,
          status: 'linked',
          activation: {
            ...record.platforms.cengage.activation,
            status: 'verified',
            verifiedAt: new Date().toISOString(),
            expectedCourseKey: record.platforms.cengage.courseKey,
          },
          assignmentsLastSeenAt:
            cengageAssignments.length > 0
              ? new Date().toISOString()
              : record.platforms.cengage.assignmentsLastSeenAt,
        },
      });
      indexUpdated = true;
    }

    return { record, indexUpdated, match };
  } finally {
    await scraper.close();
  }
}

function finalStatus(params: {
  assignments: NormalizedAssignment[];
  sources: SourceState;
}): AssignmentResolverResponse['status'] {
  if (params.sources.cengage.status === 'needs_course_selection') {
    return 'needs_course_selection';
  }
  if (params.sources.cengage.status === 'needs_course_activation') {
    return params.assignments.length > 0
      ? 'partial'
      : 'needs_course_activation';
  }
  if (params.assignments.length > 0) {
    if (
      params.sources.cengage.status === 'error' ||
      params.sources.cengage.status === 'auth_required'
    ) {
      return 'partial';
    }
    return 'ok';
  }
  return 'no_data';
}

function finalMessage(params: {
  status: AssignmentResolverResponse['status'];
  sources: SourceState;
  includeExternal: 'auto' | 'always' | 'never';
}): string {
  if (params.status === 'needs_course_selection') {
    return 'A Cengage/WebAssign course match is ambiguous. Choose a candidate and retry with platformSelection.cengage.';
  }
  if (params.status === 'needs_course_activation') {
    return 'Cengage/WebAssign found the course mapping, but WebAssign opened a different active course. The answer is blocked until the intended course activates correctly.';
  }
  if (params.status === 'no_data') {
    if (params.sources.cengage.status === 'unsupported_platform') {
      return 'A matching Cengage dashboard course was found, but its platform is not WebAssign. Assignment extraction is currently unsupported for that platform.';
    }
    return 'No assignments were found after checking every required source for this request.';
  }
  if (
    params.includeExternal === 'auto' &&
    params.sources.cengage.status === 'not_checked'
  ) {
    return 'Returned eClass assignments. Cengage/WebAssign was not forced because eClass had assignments and no saved external mapping/auth requirement required a check.';
  }
  return 'Returned assignments from the checked sources.';
}

export async function getAssignments(
  args: GetAssignmentsInput,
  cengageAuthRetryAttempted: boolean = false,
  eclassAuthRetryAttempted: boolean = false,
  deps: ToolDependencies = createDefaultToolDependencies()
): Promise<McpTextResponse> {
  const includeExternal = args.includeExternal || 'auto';
  const sources = defaultSources();
  let assignments: NormalizedAssignment[] = [];
  let selectedCourse: Course | undefined;
  let eclassIdentity: CoursePlatformEClassIdentity | undefined;
  let platformRecord: CoursePlatformRecord | undefined;
  let indexUpdated = false;

  try {
    const { courses } = await getEclassCoursesWithCache(deps.eclassScraper);
    const courseResolution = resolveTargetCourse(args, courses);

    if (courseResolution.status === 'ambiguous') {
      return assignmentResponse({
        status: 'needs_course_selection',
        courseCandidates: courseResolution.candidates,
        assignments: [],
        sources: {
          ...sources,
          eclass: {
            checked: true,
            status: 'selection_required',
            assignmentCount: 0,
          },
        },
        platformIndex: { hit: false },
        message: courseResolution.message,
      });
    }

    selectedCourse = courseResolution.course;
    eclassIdentity = courseToIdentity(
      selectedCourse,
      courseResolution.syntheticCourse
    );

    if (courseResolution.status === 'selected' && selectedCourse?.id) {
      const deadlineResult = await getEclassDeadlineItems(
        {
          courseId: selectedCourse.id,
          scope: args.scope,
          month: args.month,
          year: args.year,
          from: args.from,
          to: args.to,
        },
        deps.eclassScraper
      );
      assignments = deadlineResult.items.map(normalizeEclassAssignment);
      sources.eclass = {
        checked: true,
        status: assignments.length > 0 ? 'ok' : 'no_data',
        assignmentCount: assignments.length,
      };
    } else if (courseResolution.status === 'all') {
      const deadlineResult = await getEclassDeadlineItems(
        {
          scope: args.scope,
          month: args.month,
          year: args.year,
          from: args.from,
          to: args.to,
        },
        deps.eclassScraper
      );
      assignments = deadlineResult.items.map(normalizeEclassAssignment);
      sources.eclass = {
        checked: true,
        status: assignments.length > 0 ? 'ok' : 'no_data',
        assignmentCount: assignments.length,
      };
    } else {
      sources.eclass = {
        checked: true,
        status: 'course_not_found',
        assignmentCount: 0,
      };
    }

    if (eclassIdentity && computeHasIdentity(eclassIdentity)) {
      platformRecord = getCoursePlatformRecord(eclassIdentity);
    }

    const linkedCourse = mappingToDashboardCourse(platformRecord);
    const cengageSessionValidity = getCengageSessionValidity();
    if (cengageSessionValidity.reason === 'storage_unavailable') {
      throw new SecureSessionStorageError(
        'read_failed',
        cengageSessionValidity.message ||
          'Secure Cengage session storage is unavailable.',
        { filePath: cengageSessionValidity.statePath }
      );
    }
    const cengageValid = cengageSessionValidity.valid;
    const mustCheckCengage =
      includeExternal === 'always' ||
      !!linkedCourse ||
      assignments.length === 0;
    const shouldCheckCengage =
      includeExternal !== 'never' &&
      (mustCheckCengage || cengageValid || !!args.platformSelection?.cengage);

    if (shouldCheckCengage) {
      if (!cengageValid && mustCheckCengage) {
        openAuthWindow('cengage');
        const authenticated = await waitForCengageAuthSession();
        if (!authenticated) {
          if (eclassIdentity && computeHasIdentity(eclassIdentity)) {
            platformRecord = recordCengageAuthRequired(eclassIdentity);
            indexUpdated = true;
          }
          return assignmentResponse(
            authRequiredResponse({
              args,
              sources,
              assignments,
              course: selectedCourse,
              record: platformRecord,
              indexUpdated,
            })
          );
        }
      } else if (!cengageValid && !mustCheckCengage) {
        sources.cengage = {
          checked: false,
          status: 'not_checked',
          assignmentCount: 0,
        };
      }

      const latestCengageValidity = getCengageSessionValidity();
      if (latestCengageValidity.reason === 'storage_unavailable') {
        throw new SecureSessionStorageError(
          'read_failed',
          latestCengageValidity.message ||
            'Secure Cengage session storage is unavailable.',
          { filePath: latestCengageValidity.statePath }
        );
      }
      if (latestCengageValidity.valid) {
        if (courseResolution.status === 'all') {
          await fetchCengageAllCourses({ args, sources, assignments, deps });
        } else if (eclassIdentity && computeHasIdentity(eclassIdentity)) {
          const result = await fetchCengageForCourse({
            args,
            eclassIdentity,
            record: platformRecord,
            sources,
            assignments,
            refreshPlatformIndex: !!args.refreshPlatformIndex,
            deps,
          });
          platformRecord = result.record || platformRecord;
          indexUpdated = indexUpdated || result.indexUpdated;
        }
      }
    }

    const sorted = sortAssignments(assignments);
    const status = finalStatus({ assignments: sorted, sources });
    return assignmentResponse({
      status,
      course: courseToResponse(selectedCourse),
      assignments: sorted,
      sources,
      platformIndex: {
        ...indexSummaryForResponse(platformRecord),
        updated: indexUpdated || undefined,
      },
      message: finalMessage({ status, sources, includeExternal }),
      nextActions:
        status === 'needs_course_selection'
          ? [
              'Retry get_assignments with platformSelection.cengage.courseId, courseKey, or courseQuery from the returned candidates.',
            ]
          : undefined,
    });
  } catch (error: unknown) {
    if (error instanceof SecureSessionStorageError) {
      const payload = toErrorPayload(
        'SESSION_STORAGE_UNAVAILABLE',
        'Secure session storage is unavailable. Set ECLASS_MCP_SESSION_SECRET, clear old plaintext sessions, then authenticate again.',
        { retry: { afterAuth: false } }
      );
      return assignmentResponse({
        status: 'error',
        code: payload.code,
        course: courseToResponse(selectedCourse),
        assignments: [],
        sources,
        platformIndex: indexSummaryForResponse(platformRecord),
        message: payload.message,
        retry: payload.retry,
      });
    }
    if (error instanceof ScrapeLayoutError) {
      const payload = toErrorPayload('SCRAPE_LAYOUT_CHANGED', error.message, {
        details: error.context,
      });
      return assignmentResponse({
        status: 'error',
        code: payload.code,
        course: courseToResponse(selectedCourse),
        assignments: [],
        sources,
        platformIndex: indexSummaryForResponse(platformRecord),
        message: payload.message,
      });
    }
    if (error instanceof SessionExpiredError) {
      const fallback = (expired: SessionExpiredError) =>
        assignmentResponse({
          status: 'needs_external_auth',
          code: 'SESSION_EXPIRED',
          course: courseToResponse(selectedCourse),
          assignments: [],
          sources,
          platformIndex: indexSummaryForResponse(platformRecord),
          message: expired.message,
          retry: {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
            input: args as Record<string, unknown>,
          },
        });

      if (!eclassAuthRetryAttempted) {
        return handleEclassSessionExpired(
          error,
          () => getAssignments(args, cengageAuthRetryAttempted, true, deps),
          fallback
        );
      }
      return fallback(error);
    }

    if (error instanceof CengageAuthRequiredError) {
      if (!cengageAuthRetryAttempted) {
        openAuthWindow('cengage');
        const authenticated = await waitForCengageAuthSession();
        if (authenticated) {
          return getAssignments(args, true, eclassAuthRetryAttempted, deps);
        }
      }

      if (eclassIdentity && computeHasIdentity(eclassIdentity)) {
        platformRecord = recordCengageAuthRequired(eclassIdentity);
        indexUpdated = true;
      }

      return assignmentResponse(
        authRequiredResponse({
          args,
          sources,
          assignments,
          course: selectedCourse,
          record: platformRecord,
          indexUpdated,
        })
      );
    }

    if (error instanceof CengageCourseActivationError) {
      const latestRecord =
        eclassIdentity && computeHasIdentity(eclassIdentity)
          ? platformRecord || getCoursePlatformRecord(eclassIdentity)
          : platformRecord;
      if (
        eclassIdentity &&
        computeHasIdentity(eclassIdentity) &&
        latestRecord?.platforms.cengage
      ) {
        const actualCourseTitle =
          typeof error.details?.actualCourseTitle === 'string'
            ? error.details.actualCourseTitle
            : typeof error.details?.actualPageTitle === 'string'
              ? error.details.actualPageTitle
              : undefined;
        const actualCurrentSelected =
          typeof error.details?.actualCurrentSelected === 'string'
            ? error.details.actualCurrentSelected
            : typeof error.details?.actualCourseId === 'string'
              ? error.details.actualCourseId
              : undefined;
        platformRecord = upsertCoursePlatformMapping({
          eclass: eclassIdentity,
          cengage: {
            ...latestRecord.platforms.cengage,
            activation: {
              status: 'failed',
              failedAt: new Date().toISOString(),
              actualCourseTitle,
              actualCurrentSelected,
              expectedCourseKey: latestRecord.platforms.cengage.courseKey,
              lastErrorCode: 'COURSE_CONTEXT_MISMATCH',
            },
          },
        });
        indexUpdated = true;
      }

      return assignmentResponse(
        activationRequiredResponse({
          args,
          sources,
          assignments,
          course: selectedCourse,
          record: platformRecord,
          indexUpdated,
          error,
        })
      );
    }

    if (error instanceof ValidationError) {
      const payload = toErrorPayload('VALIDATION_FAILED', error.message, {
        details: error.details,
      });
      return assignmentResponse({
        status: 'error',
        code: payload.code,
        course: courseToResponse(selectedCourse),
        assignments: [],
        sources,
        platformIndex: indexSummaryForResponse(platformRecord),
        message: payload.message,
      });
    }

    if (error instanceof CengageError) {
      sources.cengage = {
        checked: true,
        status: isCengageCourseContextMismatch(error)
          ? 'needs_course_activation'
          : 'error',
        assignmentCount: 0,
      };
      const sorted = sortAssignments(assignments);
      return assignmentResponse({
        status: sorted.length > 0 ? 'partial' : 'error',
        course: courseToResponse(selectedCourse),
        assignments: sorted,
        sources,
        platformIndex: indexSummaryForResponse(platformRecord),
        message: `${error.message} [${error.code}]`,
        retry: isCengageCourseContextMismatch(error)
          ? {
              afterAuth: true,
              authUrl: getAuthUrl('cengage'),
              input: args as Record<string, unknown>,
            }
          : undefined,
        nextActions: isCengageCourseContextMismatch(error)
          ? [
              'Complete Cengage/WebAssign login again, ensure the intended course opens, then retry get_assignments.',
            ]
          : undefined,
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    return assignmentResponse({
      status: 'error',
      course: courseToResponse(selectedCourse),
      assignments: [],
      sources,
      platformIndex: indexSummaryForResponse(platformRecord),
      message,
    });
  }
}

function computeHasIdentity(identity: CoursePlatformEClassIdentity): boolean {
  return !!(
    identity.courseId ||
    identity.courseCode ||
    identity.courseName ||
    identity.url
  );
}

function indexSummaryForResponse(record: CoursePlatformRecord | undefined): {
  hit: boolean;
  recordId?: string;
  mappingStatus?: string;
} {
  return {
    hit: !!record,
    recordId: record?.recordId,
    mappingStatus: record?.platforms.cengage?.status,
  };
}
