import { CengageScraper } from '../scraper/cengage';
import {
  resolveDashboardCourseSelection,
  type CengageDashboardCourse,
} from '../scraper/cengage-courses';
import {
  CengageAuthRequiredError,
  CengageCourseActivationError,
  CengageError,
  CengageNavigationError,
} from '../scraper/cengage-errors';
import { normalizeAndClassifyCengageEntry } from '../scraper/cengage-url';
import { getAuthUrl, openAuthWindow } from '../auth/server';
import { cache, TTL } from '../cache/store';
import type {
  DiscoverCengageLinksInput,
  DiscoverCengageLinksResponse,
  GetCengageAssignmentDetailsInput,
  GetCengageAssignmentDetailsResponse,
  GetCengageAssignmentsInput,
  GetCengageAssignmentsResponse,
  ListCengageCoursesInput,
  ListCengageCoursesResponse,
} from './cengage-contracts';
import {
  cengageCacheKey,
  toCacheHitMeta,
  toCacheMissMeta,
  withCacheMeta,
} from './cengage/cache';
import {
  discoverCengageLinksFromFileBlocks,
  discoverCengageLinksFromText,
  type DiscoverCengageLinksFromFileBlocksInput,
} from './cengage/link-discovery';
import {
  mapAuthReason,
  mapCourseSummary,
  normalizeAssignmentStatus,
  resolveAssignmentDetailsInput,
  resolveAssignmentsInput,
  resolveListingEntryUrl,
  summarizeCourseCandidates,
  toRetryInputRecord,
} from './cengage/mappers';
import {
  asAssignmentDetailsToolResponse,
  asAssignmentsToolResponse,
  asDiscoverToolResponse,
  asListCoursesToolResponse,
} from './cengage/responses';
import {
  CENGAGE_LIST_COURSES_TTL_MINUTES,
  CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY,
  getCengageAssignmentsForCourse,
  getCengageDashboardInventory,
} from './cengage/service';

// Keep tool entry points centralized while pure helpers live under src/tools/cengage/.
const CENGAGE_DISCOVERY_TTL_MINUTES = TTL.CONTENT;
const CENGAGE_ASSIGNMENTS_TTL_MINUTES = TTL.DEADLINES;
const CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES = TTL.DEADLINES;
const CENGAGE_ALL_COURSES_DEFAULT_LIMIT = 5;
const CENGAGE_ALL_COURSES_HARD_LIMIT = 10;
const CENGAGE_ALL_ASSIGNMENTS_PER_COURSE_DEFAULT = 10;
const CENGAGE_ALL_ASSIGNMENTS_PER_COURSE_HARD_LIMIT = 25;

export { discoverCengageLinksFromFileBlocks, discoverCengageLinksFromText };
export type { DiscoverCengageLinksFromFileBlocksInput };

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
  hardLimit: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value as number);
  if (normalized < 1) {
    return fallback;
  }

  return Math.min(normalized, hardLimit);
}

function filterCoursesForAggregation(
  courses: CengageDashboardCourse[],
  courseQuery?: string
): CengageDashboardCourse[] {
  const query = (courseQuery || '').trim().toLowerCase();
  if (!query) {
    return courses;
  }

  return courses.filter((course) => {
    const haystack = [course.title, course.courseId, course.courseKey]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });
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
    'This tool currently scrapes WebAssign assignments only, so the course is listed but assignment extraction is not supported for that platform yet.'
  );
}

function mapAssignmentRows(
  assignments: Awaited<ReturnType<CengageScraper['getAssignments']>>
): GetCengageAssignmentsResponse['assignments'] {
  return assignments.map((a) => ({
    name: a.name,
    dueDate: a.dueDate,
    dueDateIso: a.dueDateIso,
    courseId: a.courseId,
    courseTitle: a.courseTitle,
    status: normalizeAssignmentStatus(a.status),
    score: a.score,
    assignmentId: a.id,
    url: a.url,
    rawText: a.rawText,
  }));
}

function activationFailurePayload(params: {
  entryUrl?: string;
  selectedCourse?: CengageDashboardCourse;
  error: CengageCourseActivationError;
  retryInput: Record<string, unknown>;
}): GetCengageAssignmentsResponse {
  return {
    status: 'needs_course_activation',
    code: 'COURSE_CONTEXT_MISMATCH',
    entryUrl: params.entryUrl,
    selectedCourse: params.selectedCourse
      ? mapCourseSummary(params.selectedCourse)
      : undefined,
    assignments: [],
    message:
      'WebAssign opened a different active course than the selected Cengage course.',
    retry: {
      afterAuth: false,
      reason: 'course_activation_required',
      input: toRetryInputRecord(params.retryInput),
    },
    diagnostics: params.error.details,
    nextActions: [
      'Open Cengage dashboard and launch the intended WebAssign course, then retry.',
      'If the problem persists, use get_cengage_assignments with allCourses=true to inspect available active contexts.',
    ],
  };
}

function activationDetailsFailurePayload(params: {
  entryUrl?: string;
  selectedCourse?: CengageDashboardCourse;
  error: CengageCourseActivationError;
  retryInput: Record<string, unknown>;
}): GetCengageAssignmentDetailsResponse {
  return {
    status: 'needs_course_activation',
    code: 'COURSE_CONTEXT_MISMATCH',
    entryUrl: params.entryUrl,
    selectedCourse: params.selectedCourse
      ? mapCourseSummary(params.selectedCourse)
      : undefined,
    message:
      'WebAssign opened a different active course than the selected Cengage course.',
    retry: {
      afterAuth: false,
      reason: 'course_activation_required',
      input: toRetryInputRecord(params.retryInput),
    },
    diagnostics: params.error.details,
    nextActions: [
      'Open Cengage dashboard and launch the intended WebAssign course, then retry.',
      'If the problem persists, use get_cengage_assignments with allCourses=true to inspect available active contexts.',
    ],
  };
}

function explicitExpectedCourse(params: {
  entryUrl: string;
  courseKey?: string;
  courseId?: string;
  courseQuery?: string;
}): CengageDashboardCourse {
  const parsed = normalizeAndClassifyCengageEntry(params.entryUrl);
  const url = new URL(parsed.normalizedUrl);
  const courseKey =
    (params.courseKey || url.searchParams.get('courseKey') || '').trim() ||
    undefined;
  const courseId = (params.courseId || '').trim() || undefined;
  return {
    courseId,
    courseKey,
    title: params.courseQuery || (courseKey ? `WebAssign ${courseKey}` : 'WebAssign'),
    launchUrl: parsed.normalizedUrl,
    platform: parsed.normalizedUrl.includes('webassign.net')
      ? 'webassign'
      : 'cengage',
    assignmentsSupported: parsed.normalizedUrl.includes('webassign.net'),
    confidence: 0.99,
  };
}

function shouldTryExplicitDirectLink(entryUrl: string | undefined): boolean {
  if (!entryUrl) return false;
  const classification = normalizeAndClassifyCengageEntry(entryUrl);
  return (
    classification.linkType === 'webassign_course' ||
    classification.linkType === 'eclass_lti'
  );
}

export async function listCengageCourses(input: ListCengageCoursesInput) {
  const entryUrl = resolveListingEntryUrl(input);
  const cacheKey = cengageCacheKey('list_courses', {
    entryUrl: entryUrl || CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY,
    discoveredLink:
      input.discoveredLink?.normalizedUrl ||
      input.discoveredLink?.rawUrl ||
      null,
    courseQuery: input.courseQuery || null,
  });

  const cached = cache.getWithMeta<ListCengageCoursesResponse>(cacheKey);
  if (cached) {
    return asListCoursesToolResponse(
      withCacheMeta(cached.data, toCacheHitMeta(cached))
    );
  }

  let scraper: CengageScraper | null = null;

  try {
    scraper = new CengageScraper();
    const courses = entryUrl
      ? await scraper.listDashboardCoursesFromEntryLink(entryUrl)
      : await getCengageDashboardInventory({ scraper });

    if (courses.length === 0) {
      const payload: ListCengageCoursesResponse = {
        status: 'no_data',
        entryUrl,
        courses: [],
        message: entryUrl
          ? 'No Cengage/WebAssign courses were discovered from the provided entry URL.'
          : 'No Cengage/WebAssign courses were discovered from the saved session bootstrap flow.',
      };
      cache.set(cacheKey, payload, CENGAGE_LIST_COURSES_TTL_MINUTES);
      return asListCoursesToolResponse(
        withCacheMeta(
          payload,
          toCacheMissMeta(CENGAGE_LIST_COURSES_TTL_MINUTES)
        )
      );
    }

    if (input.courseQuery && input.courseQuery.trim()) {
      const resolved = resolveDashboardCourseSelection(courses, {
        courseQuery: input.courseQuery,
      });

      if (resolved.status === 'selected' && resolved.selectedCourse) {
        const payload: ListCengageCoursesResponse = {
          status: 'ok',
          entryUrl,
          courses: [mapCourseSummary(resolved.selectedCourse)],
          message: resolved.message,
        };
        cache.set(cacheKey, payload, CENGAGE_LIST_COURSES_TTL_MINUTES);
        return asListCoursesToolResponse(
          withCacheMeta(
            payload,
            toCacheMissMeta(CENGAGE_LIST_COURSES_TTL_MINUTES)
          )
        );
      }

      if (
        resolved.status === 'ambiguous' ||
        resolved.status === 'selection_required'
      ) {
        const payload: ListCengageCoursesResponse = {
          status: 'needs_course_selection',
          entryUrl,
          courses: resolved.candidates.map(mapCourseSummary),
          message: resolved.message,
        };
        cache.set(cacheKey, payload, CENGAGE_LIST_COURSES_TTL_MINUTES);
        return asListCoursesToolResponse(
          withCacheMeta(
            payload,
            toCacheMissMeta(CENGAGE_LIST_COURSES_TTL_MINUTES)
          )
        );
      }

      if (resolved.status === 'not_found') {
        const payload: ListCengageCoursesResponse = {
          status: 'no_data',
          entryUrl,
          courses: [],
          message: resolved.message,
        };
        cache.set(cacheKey, payload, CENGAGE_LIST_COURSES_TTL_MINUTES);
        return asListCoursesToolResponse(
          withCacheMeta(
            payload,
            toCacheMissMeta(CENGAGE_LIST_COURSES_TTL_MINUTES)
          )
        );
      }
    }

    const payload: ListCengageCoursesResponse = {
      status: 'ok',
      entryUrl,
      courses: courses.map(mapCourseSummary),
    };
    cache.set(cacheKey, payload, CENGAGE_LIST_COURSES_TTL_MINUTES);
    return asListCoursesToolResponse(
      withCacheMeta(payload, toCacheMissMeta(CENGAGE_LIST_COURSES_TTL_MINUTES))
    );
  } catch (error: unknown) {
    if (error instanceof CengageAuthRequiredError) {
      const authUrl = getAuthUrl('cengage');
      openAuthWindow('cengage');

      return asListCoursesToolResponse({
        status: 'auth_required',
        code: 'SESSION_EXPIRED',
        entryUrl,
        courses: [],
        message:
          `Cengage authentication required. Opened auth at ${authUrl}. ` +
          'Complete login and retry the same tool call.',
        retry: {
          afterAuth: true,
          authUrl,
          reason: mapAuthReason(error),
          input: toRetryInputRecord({
            entryUrl: input.entryUrl,
            discoveredLink: input.discoveredLink,
            courseQuery: input.courseQuery,
          }),
        },
      });
    }

    if (error instanceof CengageError) {
      return asListCoursesToolResponse({
        status: 'error',
        entryUrl,
        courses: [],
        message: `${error.message} [${error.code}]`,
      });
    }

    if (error instanceof Error) {
      return asListCoursesToolResponse({
        status: 'error',
        entryUrl,
        courses: [],
        message: `Failed to list Cengage courses: ${error.message}`,
      });
    }

    return asListCoursesToolResponse({
      status: 'error',
      entryUrl,
      courses: [],
      message: 'Failed to list Cengage courses due to an unknown error.',
    });
  } finally {
    if (scraper) {
      await scraper.close();
    }
  }
}

export async function discoverCengageLinks(input: DiscoverCengageLinksInput) {
  const cacheKey = cengageCacheKey('discover_links', {
    text: input.text,
    source: input.source || 'manual',
    courseId: input.courseId || null,
    sectionUrl: input.sectionUrl || null,
    sourceFileName: input.sourceFile?.fileName || null,
    sourceFileUrl: input.sourceFile?.fileUrl || null,
    sourceFileType: input.sourceFile?.fileType || null,
    sourceFileBlockIndex:
      typeof input.sourceFile?.blockIndex === 'number'
        ? input.sourceFile.blockIndex
        : null,
  });

  const cached = cache.getWithMeta<DiscoverCengageLinksResponse>(cacheKey);
  if (cached) {
    return asDiscoverToolResponse(
      withCacheMeta(cached.data, toCacheHitMeta(cached))
    );
  }

  try {
    const payload = discoverCengageLinksFromText(input);
    cache.set(cacheKey, payload, CENGAGE_DISCOVERY_TTL_MINUTES);
    return asDiscoverToolResponse(
      withCacheMeta(payload, toCacheMissMeta(CENGAGE_DISCOVERY_TTL_MINUTES))
    );
  } catch (error) {
    if (error instanceof Error) {
      return asDiscoverToolResponse({
        status: 'error',
        links: [],
        message: `Failed to discover Cengage links: ${error.message}`,
      });
    }

    return asDiscoverToolResponse({
      status: 'error',
      links: [],
      message: 'Failed to discover Cengage links due to an unknown error.',
    });
  }
}

function coerceAvailableAssignments(
  value: unknown
): GetCengageAssignmentDetailsResponse['availableAssignments'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((candidate): candidate is Record<string, unknown> => {
      return !!candidate && typeof candidate === 'object';
    })
    .map((candidate) => {
      const status = normalizeAssignmentStatus(String(candidate.status || ''));

      return {
        assignmentId:
          typeof candidate.assignmentId === 'string'
            ? candidate.assignmentId
            : undefined,
        name: typeof candidate.name === 'string' ? candidate.name : '',
        dueDate:
          typeof candidate.dueDate === 'string' ? candidate.dueDate : undefined,
        dueDateIso:
          typeof candidate.dueDateIso === 'string'
            ? candidate.dueDateIso
            : undefined,
        status,
        score:
          typeof candidate.score === 'string' ? candidate.score : undefined,
        url: typeof candidate.url === 'string' ? candidate.url : undefined,
      };
    })
    .filter((candidate) => candidate.name.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

export async function getCengageAssignmentDetails(
  input: GetCengageAssignmentDetailsInput | string
) {
  const args = resolveAssignmentDetailsInput(input);
  const entryUrl = (args.entryUrl || args.ssoUrl || '').trim() || undefined;

  const cacheKey = cengageCacheKey('assignment_details', {
    entryUrl: entryUrl || CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY,
    courseId: args.courseId || null,
    courseKey: args.courseKey || null,
    courseQuery: args.courseQuery || null,
    assignmentUrl: args.assignmentUrl || null,
    assignmentId: args.assignmentId || null,
    assignmentQuery: args.assignmentQuery || null,
    includeAnswers: args.includeAnswers ?? true,
    includeResources: args.includeResources ?? true,
    includeAssetInventory: args.includeAssetInventory ?? true,
    includeRenderedMedia: args.includeRenderedMedia ?? true,
    maxRenderedImages: args.maxRenderedImages || null,
    maxCaptureUnits: args.maxCaptureUnits || null,
    maxCapturePerQuestion: args.maxCapturePerQuestion || null,
    maxInteractiveAssets: args.maxInteractiveAssets || null,
    maxMediaAssets: args.maxMediaAssets || null,
    maxMediaPayloadBytes: args.maxMediaPayloadBytes || null,
    minTextForSafeText: args.minTextForSafeText || null,
    captureDpi: args.captureDpi || null,
    maxQuestions: args.maxQuestions || null,
    maxQuestionTextChars: args.maxQuestionTextChars || null,
    maxAnswerTextChars: args.maxAnswerTextChars || null,
  });

  const cached =
    cache.getWithMeta<GetCengageAssignmentDetailsResponse>(cacheKey);
  if (cached) {
    return asAssignmentDetailsToolResponse(
      withCacheMeta(cached.data, toCacheHitMeta(cached))
    );
  }

  let scraper: CengageScraper | null = null;
  let selectedCourseForResponse: CengageDashboardCourse | undefined;

  try {
    scraper = new CengageScraper();

    const courses = entryUrl
      ? await scraper.listDashboardCoursesFromEntryLink(entryUrl)
      : await getCengageDashboardInventory({ scraper });

    const selection = resolveDashboardCourseSelection(courses, {
      courseId: args.courseId,
      courseKey: args.courseKey,
      courseQuery: args.courseQuery,
    });

    if (
      selection.status === 'selection_required' ||
      selection.status === 'ambiguous'
    ) {
      const candidatesSummary = summarizeCourseCandidates(selection.candidates);
      const suffix = candidatesSummary
        ? ` Candidates: ${candidatesSummary}`
        : '';

      const payload: GetCengageAssignmentDetailsResponse = {
        status: 'needs_course_selection',
        entryUrl,
        message: `${selection.message}${suffix}`,
      };
      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES);
      return asAssignmentDetailsToolResponse(
        withCacheMeta(
          payload,
          toCacheMissMeta(CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES)
        )
      );
    }

    if (selection.status === 'not_found' || !selection.selectedCourse) {
      const payload: GetCengageAssignmentDetailsResponse = {
        status: 'no_data',
        entryUrl,
        message: selection.message,
      };
      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES);
      return asAssignmentDetailsToolResponse(
        withCacheMeta(
          payload,
          toCacheMissMeta(CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES)
        )
      );
    }

    const selectedCourse = selection.selectedCourse;
    if (!supportsWebAssignAssignments(selectedCourse)) {
      const payload: GetCengageAssignmentDetailsResponse = {
        status: 'no_data',
        entryUrl,
        selectedCourse: mapCourseSummary(selectedCourse),
        message: unsupportedAssignmentPlatformMessage(selectedCourse),
      };
      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES);
      return asAssignmentDetailsToolResponse(
        withCacheMeta(
          payload,
          toCacheMissMeta(CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES)
        )
      );
    }

    selectedCourseForResponse = selectedCourse;
    const detailResult = await scraper.getAssignmentDetails(
      selectedCourse.launchUrl,
      {
        expectedCourse: selectedCourse,
        expectedCourseTitle: args.courseQuery,
        assignmentUrl: args.assignmentUrl,
        assignmentId: args.assignmentId,
        assignmentQuery: args.assignmentQuery,
        maxQuestions: args.maxQuestions,
        maxQuestionTextChars: args.maxQuestionTextChars,
        maxAnswerTextChars: args.maxAnswerTextChars,
        includeAnswers: args.includeAnswers,
        includeResources: args.includeResources,
        includeAssetInventory: args.includeAssetInventory,
        includeRenderedMedia: args.includeRenderedMedia,
        maxRenderedImages: args.maxRenderedImages,
        maxCaptureUnits: args.maxCaptureUnits,
        maxCapturePerQuestion: args.maxCapturePerQuestion,
        maxInteractiveAssets: args.maxInteractiveAssets,
        maxMediaAssets: args.maxMediaAssets,
        maxMediaPayloadBytes: args.maxMediaPayloadBytes,
        minTextForSafeText: args.minTextForSafeText,
        captureDpi: args.captureDpi,
      }
    );

    const payload: GetCengageAssignmentDetailsResponse = {
      status: detailResult.details.questionCount > 0 ? 'ok' : 'no_data',
      entryUrl,
      selectedCourse: mapCourseSummary(selectedCourse),
      selectedAssignment: detailResult.selectedAssignment,
      availableAssignments: detailResult.availableAssignments,
      details: {
        pageTitle: detailResult.details.pageTitle,
        heading: detailResult.details.heading,
        questionCount: detailResult.details.questionCount,
        returnedQuestionCount: detailResult.details.returnedQuestionCount,
        truncatedQuestions: detailResult.details.truncatedQuestions,
        extractionWarnings: detailResult.details.extractionWarnings,
        completenessLevel: detailResult.details.completenessLevel,
        extractionOverview: detailResult.details.extractionOverview,
        renderedMediaSummary: detailResult.details.renderedMediaSummary,
        questions: detailResult.details.questions,
      },
      ...(detailResult.selectionMessage
        ? { message: detailResult.selectionMessage }
        : {}),
    };

    cache.set(cacheKey, payload, CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES);
    return asAssignmentDetailsToolResponse(
      withCacheMeta(
        payload,
        toCacheMissMeta(CENGAGE_ASSIGNMENT_DETAILS_TTL_MINUTES)
      )
    );
  } catch (error: unknown) {
    if (error instanceof CengageAuthRequiredError) {
      const authUrl = getAuthUrl('cengage');
      openAuthWindow('cengage');

      return asAssignmentDetailsToolResponse({
        status: 'auth_required',
        code: 'SESSION_EXPIRED',
        entryUrl,
        message:
          `Cengage authentication required. Opened auth at ${authUrl}. ` +
          'Complete login and retry the same tool call.',
        retry: {
          afterAuth: true,
          authUrl,
          reason: mapAuthReason(error),
          input: toRetryInputRecord({
            entryUrl: args.entryUrl,
            ssoUrl: args.ssoUrl,
            courseId: args.courseId,
            courseKey: args.courseKey,
            courseQuery: args.courseQuery,
            assignmentUrl: args.assignmentUrl,
            assignmentId: args.assignmentId,
            assignmentQuery: args.assignmentQuery,
            maxQuestions: args.maxQuestions,
            maxQuestionTextChars: args.maxQuestionTextChars,
            maxAnswerTextChars: args.maxAnswerTextChars,
            includeAnswers: args.includeAnswers,
            includeResources: args.includeResources,
            includeAssetInventory: args.includeAssetInventory,
            includeRenderedMedia: args.includeRenderedMedia,
            maxRenderedImages: args.maxRenderedImages,
            maxCaptureUnits: args.maxCaptureUnits,
            maxCapturePerQuestion: args.maxCapturePerQuestion,
            maxInteractiveAssets: args.maxInteractiveAssets,
            maxMediaAssets: args.maxMediaAssets,
            maxMediaPayloadBytes: args.maxMediaPayloadBytes,
            minTextForSafeText: args.minTextForSafeText,
            captureDpi: args.captureDpi,
          }),
        },
      });
    }

    if (error instanceof CengageCourseActivationError) {
      return asAssignmentDetailsToolResponse(
        activationDetailsFailurePayload({
          entryUrl,
          selectedCourse: selectedCourseForResponse,
          error,
          retryInput: {
            entryUrl: args.entryUrl,
            ssoUrl: args.ssoUrl,
            courseId: args.courseId,
            courseKey: args.courseKey || selectedCourseForResponse?.courseKey,
            courseQuery: args.courseQuery || selectedCourseForResponse?.title,
            assignmentUrl: args.assignmentUrl,
            assignmentId: args.assignmentId,
            assignmentQuery: args.assignmentQuery,
          },
        })
      );
    }

    if (error instanceof CengageError) {
      const availableAssignments = coerceAvailableAssignments(
        error.details?.availableAssignments
      );

      if (error.code === 'parse_failed' && availableAssignments) {
        return asAssignmentDetailsToolResponse({
          status: 'no_data',
          entryUrl,
          availableAssignments,
          message: error.message,
        });
      }

      return asAssignmentDetailsToolResponse({
        status: 'error',
        entryUrl,
        ...(availableAssignments ? { availableAssignments } : {}),
        message: `${error.message} [${error.code}]`,
      });
    }

    if (error instanceof Error) {
      return asAssignmentDetailsToolResponse({
        status: 'error',
        entryUrl,
        message: `Failed to fetch Cengage assignment details: ${error.message}`,
      });
    }

    return asAssignmentDetailsToolResponse({
      status: 'error',
      entryUrl,
      message:
        'Failed to fetch Cengage assignment details due to an unknown error.',
    });
  } finally {
    if (scraper) {
      await scraper.close();
    }
  }
}

export async function getCengageAssignments(
  input: GetCengageAssignmentsInput | string
) {
  const args = resolveAssignmentsInput(input);
  const entryUrl = (args.entryUrl || args.ssoUrl || '').trim() || undefined;

  const cacheKey = cengageCacheKey('assignments', {
    entryUrl: entryUrl || CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY,
    courseId: args.courseId || null,
    courseKey: args.courseKey || null,
    courseQuery: args.courseQuery || null,
    allCourses: !!args.allCourses,
    maxCourses: args.maxCourses || null,
    maxAssignmentsPerCourse: args.maxAssignmentsPerCourse || null,
  });

  const cached = cache.getWithMeta<GetCengageAssignmentsResponse>(cacheKey);
  if (cached) {
    return asAssignmentsToolResponse(
      withCacheMeta(cached.data, toCacheHitMeta(cached))
    );
  }

  let scraper: CengageScraper | null = null;
  let selectedCourseForResponse: CengageDashboardCourse | undefined;

  try {
    scraper = new CengageScraper();

    if (!args.allCourses && shouldTryExplicitDirectLink(entryUrl)) {
      const expectedCourse = explicitExpectedCourse({
        entryUrl: entryUrl as string,
        courseId: args.courseId,
        courseKey: args.courseKey,
        courseQuery: args.courseQuery,
      });
      selectedCourseForResponse = expectedCourse;

      try {
        const directResult = await scraper.getAssignmentsWithContext(
          entryUrl as string,
          {
            expectedCourse,
            expectedCourseTitle: args.courseQuery,
          }
        );
        const assignmentRows = mapAssignmentRows(directResult.assignments);
        const payload: GetCengageAssignmentsResponse = {
          status: directResult.assignments.length > 0 ? 'ok' : 'no_data',
          entryUrl,
          selectedCourse: mapCourseSummary(expectedCourse),
          assignments: assignmentRows,
          ...(directResult.assignments.length === 0
            ? {
                message:
                  'No assignments were found in the verified WebAssign course context.',
              }
            : {}),
        };
        cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
        return asAssignmentsToolResponse(
          withCacheMeta(
            payload,
            toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES)
          )
        );
      } catch (error: unknown) {
        if (error instanceof CengageCourseActivationError) {
          const payload = activationFailurePayload({
            entryUrl,
            selectedCourse: expectedCourse,
            error,
            retryInput: {
              entryUrl: args.entryUrl,
              ssoUrl: args.ssoUrl,
              courseId: args.courseId,
              courseKey: args.courseKey || expectedCourse.courseKey,
              courseQuery: args.courseQuery,
            },
          });
          return asAssignmentsToolResponse(
            withCacheMeta(
              payload,
              toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES)
            )
          );
        }

        const canFallBackToDashboardSelection =
          error instanceof CengageNavigationError &&
          String(error.message).includes('Cengage dashboard');
        if (!canFallBackToDashboardSelection) {
          throw error;
        }
      }
    }

    const courses = entryUrl
      ? await scraper.listDashboardCoursesFromEntryLink(entryUrl)
      : await getCengageDashboardInventory({ scraper });

    if (args.allCourses) {
      const filteredCourses = filterCoursesForAggregation(
        courses,
        args.courseQuery
      );

      const maxCourses = clampPositiveInt(
        args.maxCourses,
        CENGAGE_ALL_COURSES_DEFAULT_LIMIT,
        CENGAGE_ALL_COURSES_HARD_LIMIT
      );
      const maxAssignmentsPerCourse = clampPositiveInt(
        args.maxAssignmentsPerCourse,
        CENGAGE_ALL_ASSIGNMENTS_PER_COURSE_DEFAULT,
        CENGAGE_ALL_ASSIGNMENTS_PER_COURSE_HARD_LIMIT
      );

      if (filteredCourses.length === 0) {
        const payload: GetCengageAssignmentsResponse = {
          status: 'no_data',
          entryUrl,
          allCourses: [],
          assignments: [],
          message:
            'No courses matched the provided filters for all-courses aggregation.',
          aggregation: {
            mode: 'all_courses',
            coursesConsidered: 0,
            coursesProcessed: 0,
            coursesReturned: 0,
            truncatedCourses: false,
            truncatedAssignments: false,
          },
        };

        cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
        return asAssignmentsToolResponse(
          withCacheMeta(
            payload,
            toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES)
          )
        );
      }

      const selectedCourses = filteredCourses.slice(0, maxCourses);
      const truncatedCourses = filteredCourses.length > selectedCourses.length;
      let truncatedAssignments = false;
      const warnings: string[] = [];

      const allCourseSummaries: NonNullable<
        GetCengageAssignmentsResponse['allCourses']
      > = [];
      const assignmentRows: GetCengageAssignmentsResponse['assignments'] = [];

      for (const course of selectedCourses) {
        if (!supportsWebAssignAssignments(course)) {
          allCourseSummaries.push({
            ...mapCourseSummary(course),
            status: 'no_data',
            assignmentCount: 0,
            returnedAssignments: 0,
            message: unsupportedAssignmentPlatformMessage(course),
          });
          continue;
        }

        try {
          const { assignments } = await getCengageAssignmentsForCourse(
            course,
            { scraper }
          );
          const limitedAssignments = assignments.slice(
            0,
            maxAssignmentsPerCourse
          );
          const courseTruncated =
            assignments.length > limitedAssignments.length;
          if (courseTruncated) {
            truncatedAssignments = true;
          }

          allCourseSummaries.push({
            ...mapCourseSummary(course),
            status: assignments.length > 0 ? 'ok' : 'no_data',
            assignmentCount: assignments.length,
            returnedAssignments: limitedAssignments.length,
            ...(courseTruncated ? { truncatedAssignments: true } : {}),
            ...(assignments.length === 0
              ? {
                  message:
                    'No assignments were returned for this course in the current session.',
                }
              : {}),
          });

          assignmentRows.push(
            ...limitedAssignments.map((a) => ({
              name: a.name,
              dueDate: a.dueDate,
              dueDateIso: a.dueDateIso,
              courseId: a.courseId || course.courseId,
              courseTitle: a.courseTitle || course.title,
              status: normalizeAssignmentStatus(a.status),
              score: a.score,
              assignmentId: a.id,
              url: a.url,
              rawText: a.rawText,
            }))
          );
        } catch (error: unknown) {
          const reason =
            error instanceof CengageError
              ? `${error.message} [${error.code}]`
              : error instanceof Error
                ? error.message
                : 'Unknown error';

          warnings.push(
            `Failed assignment fetch for ${course.title}: ${reason}`
          );
          allCourseSummaries.push({
            ...mapCourseSummary(course),
            status: 'error',
            assignmentCount: 0,
            returnedAssignments: 0,
            message: reason,
          });
        }
      }

      const hasAssignments = assignmentRows.length > 0;
      const hasErrors = allCourseSummaries.some(
        (course) => course.status === 'error'
      );

      const payload: GetCengageAssignmentsResponse = {
        status: hasAssignments ? 'ok' : hasErrors ? 'error' : 'no_data',
        entryUrl,
        allCourses: allCourseSummaries,
        assignments: assignmentRows,
        message: hasAssignments
          ? `Aggregated ${assignmentRows.length} assignment entries across ${allCourseSummaries.length} course(s).`
          : hasErrors
            ? 'All-courses assignment aggregation failed before any assignments were returned.'
            : 'No assignments were found across the selected courses.',
        aggregation: {
          mode: 'all_courses',
          coursesConsidered: filteredCourses.length,
          coursesProcessed: selectedCourses.length,
          coursesReturned: allCourseSummaries.length,
          truncatedCourses,
          truncatedAssignments,
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };

      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
      return asAssignmentsToolResponse(
        withCacheMeta(payload, toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES))
      );
    }

    const selection = resolveDashboardCourseSelection(courses, {
      courseId: args.courseId,
      courseKey: args.courseKey,
      courseQuery: args.courseQuery,
    });

    if (
      selection.status === 'selection_required' ||
      selection.status === 'ambiguous'
    ) {
      const candidatesSummary = summarizeCourseCandidates(selection.candidates);
      const suffix = candidatesSummary
        ? ` Candidates: ${candidatesSummary}`
        : '';

      const payload: GetCengageAssignmentsResponse = {
        status: 'needs_course_selection',
        entryUrl,
        assignments: [],
        message: `${selection.message}${suffix}`,
      };
      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
      return asAssignmentsToolResponse(
        withCacheMeta(payload, toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES))
      );
    }

    if (selection.status === 'not_found' || !selection.selectedCourse) {
      const payload: GetCengageAssignmentsResponse = {
        status: 'no_data',
        entryUrl,
        assignments: [],
        message: selection.message,
      };
      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
      return asAssignmentsToolResponse(
        withCacheMeta(payload, toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES))
      );
    }

    const selectedCourse = selection.selectedCourse;
    if (!supportsWebAssignAssignments(selectedCourse)) {
      const payload: GetCengageAssignmentsResponse = {
        status: 'no_data',
        entryUrl,
        selectedCourse: mapCourseSummary(selectedCourse),
        assignments: [],
        message: unsupportedAssignmentPlatformMessage(selectedCourse),
      };
      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
      return asAssignmentsToolResponse(
        withCacheMeta(payload, toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES))
      );
    }

    selectedCourseForResponse = selectedCourse;
    const { assignments } = await getCengageAssignmentsForCourse(
      selectedCourse,
      {
        scraper,
        expectedCourseTitle: args.courseQuery,
      }
    );

    const assignmentRows = mapAssignmentRows(assignments);

    if (assignments.length === 0) {
      const payload: GetCengageAssignmentsResponse = {
        status: 'no_data',
        entryUrl,
        selectedCourse: mapCourseSummary(selectedCourse),
        assignments: assignmentRows,
        message:
          'No assignments were found. Verify the URL points to the correct course/dashboard and that your Cengage session is active.',
      };
      cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
      return asAssignmentsToolResponse(
        withCacheMeta(payload, toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES))
      );
    }

    const payload: GetCengageAssignmentsResponse = {
      status: 'ok',
      entryUrl,
      selectedCourse: mapCourseSummary(selectedCourse),
      assignments: assignmentRows,
    };
    cache.set(cacheKey, payload, CENGAGE_ASSIGNMENTS_TTL_MINUTES);
    return asAssignmentsToolResponse(
      withCacheMeta(payload, toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES))
    );
  } catch (error: unknown) {
    if (error instanceof CengageAuthRequiredError) {
      const authUrl = getAuthUrl('cengage');
      openAuthWindow('cengage');

      return asAssignmentsToolResponse({
        status: 'auth_required',
        code: 'SESSION_EXPIRED',
        entryUrl,
        assignments: [],
        message:
          `Cengage authentication required. Opened auth at ${authUrl}. ` +
          'Complete login and retry the same tool call.',
        retry: {
          afterAuth: true,
          authUrl,
          reason: mapAuthReason(error),
          input: toRetryInputRecord({
            entryUrl: args.entryUrl,
            ssoUrl: args.ssoUrl,
            courseId: args.courseId,
            courseKey: args.courseKey,
            courseQuery: args.courseQuery,
            allCourses: args.allCourses,
            maxCourses: args.maxCourses,
            maxAssignmentsPerCourse: args.maxAssignmentsPerCourse,
          }),
        },
      });
    }

    if (error instanceof CengageCourseActivationError) {
      return asAssignmentsToolResponse(
        activationFailurePayload({
          entryUrl,
          selectedCourse: selectedCourseForResponse,
          error,
          retryInput: {
            entryUrl: args.entryUrl,
            ssoUrl: args.ssoUrl,
            courseId: args.courseId,
            courseKey: args.courseKey || selectedCourseForResponse?.courseKey,
            courseQuery: args.courseQuery || selectedCourseForResponse?.title,
            allCourses: args.allCourses,
            maxCourses: args.maxCourses,
            maxAssignmentsPerCourse: args.maxAssignmentsPerCourse,
          },
        })
      );
    }

    if (error instanceof CengageError) {
      return asAssignmentsToolResponse({
        status: 'error',
        entryUrl,
        assignments: [],
        message: `${error.message} [${error.code}]`,
      });
    }

    if (error instanceof Error) {
      return asAssignmentsToolResponse({
        status: 'error',
        entryUrl,
        assignments: [],
        message: `Failed to fetch Cengage assignments: ${error.message}`,
      });
    }

    return asAssignmentsToolResponse({
      status: 'error',
      entryUrl,
      assignments: [],
      message: 'Failed to fetch Cengage assignments due to an unknown error.',
    });
  } finally {
    if (scraper) {
      await scraper.close();
    }
  }
}
