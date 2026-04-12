import { CengageScraper } from '../scraper/cengage';
import {
  resolveDashboardCourseSelection,
  type CengageDashboardCourse,
} from '../scraper/cengage-courses';
import {
  CengageAuthRequiredError,
  CengageError,
} from '../scraper/cengage-errors';
import { getAuthUrl, openAuthWindow } from '../auth/server';
import { cache, getCacheKey, TTL } from '../cache/store';
import type {
  DiscoverCengageLinksInput,
  DiscoverCengageLinksResponse,
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
} from './cengage-cache';
import {
  discoverCengageLinksFromFileBlocks,
  discoverCengageLinksFromText,
  type DiscoverCengageLinksFromFileBlocksInput,
} from './cengage-link-discovery';
import {
  mapAuthReason,
  mapCourseSummary,
  normalizeAssignmentStatus,
  resolveAssignmentsInput,
  resolveListingEntryUrl,
  summarizeCourseCandidates,
  toRetryInputRecord,
} from './cengage-mappers';
import {
  asAssignmentsToolResponse,
  asDiscoverToolResponse,
  asListCoursesToolResponse,
} from './cengage-responses';

const CENGAGE_DISCOVERY_TTL_MINUTES = TTL.CONTENT;
const CENGAGE_LIST_COURSES_TTL_MINUTES = TTL.CONTENT;
const CENGAGE_ASSIGNMENTS_TTL_MINUTES = TTL.DEADLINES;
const CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY = '__dashboard_session__';
const CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY = getCacheKey(
  'cengage',
  'dashboard_inventory',
  'session'
);

export {
  discoverCengageLinksFromFileBlocks,
  discoverCengageLinksFromText,
};
export type { DiscoverCengageLinksFromFileBlocksInput };

async function getDashboardInventoryFromSessionCache(
  scraper: CengageScraper
): Promise<CengageDashboardCourse[]> {
  const cached = cache.getWithMeta<CengageDashboardCourse[]>(
    CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY
  );
  if (cached) {
    return cached.data;
  }

  const courses = await scraper.listDashboardCoursesFromSavedSession();
  cache.set(
    CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY,
    courses,
    CENGAGE_LIST_COURSES_TTL_MINUTES
  );
  return courses;
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
      : await getDashboardInventoryFromSessionCache(scraper);

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
  });

  const cached = cache.getWithMeta<GetCengageAssignmentsResponse>(cacheKey);
  if (cached) {
    return asAssignmentsToolResponse(
      withCacheMeta(cached.data, toCacheHitMeta(cached))
    );
  }

  let scraper: CengageScraper | null = null;

  try {
    scraper = new CengageScraper();

    const courses = entryUrl
      ? await scraper.listDashboardCoursesFromEntryLink(entryUrl)
      : await getDashboardInventoryFromSessionCache(scraper);
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
    const assignments = await scraper.getAssignments(selectedCourse.launchUrl);

    const assignmentRows = assignments.map((a) => ({
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
          }),
        },
      });
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
