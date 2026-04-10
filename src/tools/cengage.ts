import { CengageScraper } from '../scraper/cengage';
import {
  resolveDashboardCourseSelection,
  type CengageDashboardCourse,
} from '../scraper/cengage-courses';
import {
  CengageAuthRequiredError,
  CengageError,
} from '../scraper/cengage-errors';
import {
  normalizeAndClassifyCengageEntry,
  type CengageEntryClassification,
  type CengageEntryLinkType,
} from '../scraper/cengage-url';
import { getAuthUrl } from '../auth/server';
import type {
  DiscoverCengageLinksInput,
  DiscoverCengageLinksResponse,
  GetCengageAssignmentsInput,
  GetCengageAssignmentsResponse,
  ListCengageCoursesInput,
  ListCengageCoursesResponse,
} from './cengage-contracts';
import {
  DiscoverCengageLinksResponseSchema,
  GetCengageAssignmentsResponseSchema,
  ListCengageCoursesResponseSchema,
} from './cengage-contracts';

const URL_REGEX_GLOBAL = /https?:\/\/[^\s<>'"\])]+/gi;

function normalizeExtractedUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .replace(/[),.;!?]+$/, '')
    .replace(/&amp;/gi, '&');
}

function isLikelyCengageHost(host: string): boolean {
  return (
    host.includes('webassign.net') ||
    host.includes('cengage.com') ||
    host.includes('eclass.yorku.ca')
  );
}

function shouldIncludeClassification(
  classification: CengageEntryClassification
): boolean {
  if (classification.linkType !== 'other') {
    return true;
  }

  return isLikelyCengageHost(classification.host);
}

function calculateLinkConfidence(linkType: CengageEntryLinkType): number {
  switch (linkType) {
    case 'webassign_course':
      return 0.98;
    case 'eclass_lti':
      return 0.95;
    case 'webassign_dashboard':
      return 0.9;
    case 'cengage_dashboard':
      return 0.88;
    case 'cengage_login':
      return 0.76;
    default:
      return 0.55;
  }
}

function getLineAndColumn(
  text: string,
  index: number
): {
  line: number;
  column: number;
} {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  const column = index - lastNewline;
  return { line, column };
}

function buildSourceHint(
  text: string,
  matchIndex: number,
  input: DiscoverCengageLinksInput
): string {
  const { line, column } = getLineAndColumn(text, matchIndex);
  const parts = [`line:${line}`, `col:${column}`];

  if (input.courseId) {
    parts.push(`courseId:${input.courseId}`);
  }

  if (input.sectionUrl) {
    parts.push(`sectionUrl:${input.sectionUrl}`);
  }

  return parts.join(' ');
}

export function discoverCengageLinksFromText(
  input: DiscoverCengageLinksInput
): DiscoverCengageLinksResponse {
  const source = input.source || 'manual';
  const links = new Map<
    string,
    DiscoverCengageLinksResponse['links'][number]
  >();

  URL_REGEX_GLOBAL.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_REGEX_GLOBAL.exec(input.text)) !== null) {
    const rawMatch = match[0];
    const candidate = normalizeExtractedUrl(rawMatch);

    try {
      const classification = normalizeAndClassifyCengageEntry(candidate);
      if (!shouldIncludeClassification(classification)) {
        continue;
      }

      const item: DiscoverCengageLinksResponse['links'][number] = {
        rawUrl: candidate,
        normalizedUrl: classification.normalizedUrl,
        linkType: classification.linkType,
        source,
        sourceHint: buildSourceHint(input.text, match.index, input),
        confidence: calculateLinkConfidence(classification.linkType),
      };

      const key = `${item.normalizedUrl}|${item.source}`;
      const existing = links.get(key);
      if (!existing || (item.confidence || 0) > (existing.confidence || 0)) {
        links.set(key, item);
      }
    } catch {
      // Ignore malformed URL candidates during discovery.
    }
  }

  const discovered = Array.from(links.values());
  if (discovered.length === 0) {
    return {
      status: 'no_data',
      links: [],
      message:
        'No Cengage/WebAssign links were detected in the provided text. Include full URLs from eClass content, announcements, or files.',
    };
  }

  return {
    status: 'ok',
    links: discovered,
  };
}

function normalizeAssignmentStatus(
  rawStatus: string
): 'pending' | 'submitted' | 'graded' | 'unknown' {
  const normalized = rawStatus.toLowerCase();
  if (normalized.includes('submitted')) return 'submitted';
  if (normalized.includes('graded')) return 'graded';
  if (normalized.includes('pending')) return 'pending';
  return 'unknown';
}

function asToolResponse(payload: GetCengageAssignmentsResponse) {
  const validated = GetCengageAssignmentsResponseSchema.parse(payload);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(validated) }],
  };
}

function asDiscoverToolResponse(payload: DiscoverCengageLinksResponse) {
  const validated = DiscoverCengageLinksResponseSchema.parse(payload);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(validated) }],
  };
}

function asListCoursesToolResponse(payload: ListCengageCoursesResponse) {
  const validated = ListCengageCoursesResponseSchema.parse(payload);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(validated) }],
  };
}

function resolveListingEntryUrl(input: ListCengageCoursesInput): string {
  if (input.discoveredLink?.normalizedUrl) {
    return input.discoveredLink.normalizedUrl;
  }

  if (input.discoveredLink?.rawUrl) {
    return input.discoveredLink.rawUrl;
  }

  return input.entryUrl;
}

function mapCourseSummary(course: CengageDashboardCourse) {
  return {
    courseId: course.courseId,
    courseKey: course.courseKey,
    title: course.title,
    launchUrl: course.launchUrl,
    platform: course.platform,
    confidence: course.confidence,
  };
}

function summarizeCourseCandidates(
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

function resolveAssignmentsInput(
  input: GetCengageAssignmentsInput | string
): GetCengageAssignmentsInput {
  if (typeof input === 'string') {
    return { ssoUrl: input };
  }

  return input;
}

export async function listCengageCourses(input: ListCengageCoursesInput) {
  const scraper = new CengageScraper();
  const entryUrl = resolveListingEntryUrl(input);

  try {
    const courses = await scraper.listDashboardCourses(entryUrl);

    if (courses.length === 0) {
      return asListCoursesToolResponse({
        status: 'no_data',
        entryUrl,
        courses: [],
        message:
          'No Cengage/WebAssign courses were discovered from the provided entry URL.',
      });
    }

    if (input.courseQuery && input.courseQuery.trim()) {
      const resolved = resolveDashboardCourseSelection(courses, {
        courseQuery: input.courseQuery,
      });

      if (resolved.status === 'selected' && resolved.selectedCourse) {
        return asListCoursesToolResponse({
          status: 'ok',
          entryUrl,
          courses: [mapCourseSummary(resolved.selectedCourse)],
          message: resolved.message,
        });
      }

      if (
        resolved.status === 'ambiguous' ||
        resolved.status === 'selection_required'
      ) {
        return asListCoursesToolResponse({
          status: 'needs_course_selection',
          entryUrl,
          courses: resolved.candidates.map(mapCourseSummary),
          message: resolved.message,
        });
      }

      if (resolved.status === 'not_found') {
        return asListCoursesToolResponse({
          status: 'no_data',
          entryUrl,
          courses: [],
          message: resolved.message,
        });
      }
    }

    return asListCoursesToolResponse({
      status: 'ok',
      entryUrl,
      courses: courses.map(mapCourseSummary),
    });
  } catch (error: unknown) {
    if (error instanceof CengageAuthRequiredError) {
      return asListCoursesToolResponse({
        status: 'auth_required',
        entryUrl,
        courses: [],
        message: `Cengage authentication required. Please log in at ${getAuthUrl('cengage')} and retry.`,
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
    await scraper.close();
  }
}

export async function discoverCengageLinks(input: DiscoverCengageLinksInput) {
  try {
    return asDiscoverToolResponse(discoverCengageLinksFromText(input));
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
  const scraper = new CengageScraper();
  const args = resolveAssignmentsInput(input);
  const entryUrl = (args.entryUrl || args.ssoUrl || '').trim();

  try {
    if (!entryUrl) {
      return asToolResponse({
        status: 'error',
        assignments: [],
        message: 'entryUrl or ssoUrl is required.',
      });
    }

    const courses = await scraper.listDashboardCourses(entryUrl);
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

      return asToolResponse({
        status: 'needs_course_selection',
        entryUrl,
        assignments: [],
        message: `${selection.message}${suffix}`,
      });
    }

    if (selection.status === 'not_found' || !selection.selectedCourse) {
      return asToolResponse({
        status: 'no_data',
        entryUrl,
        assignments: [],
        message: selection.message,
      });
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
      return asToolResponse({
        status: 'no_data',
        entryUrl,
        selectedCourse: mapCourseSummary(selectedCourse),
        assignments: assignmentRows,
        message:
          'No assignments were found. Verify the URL points to the correct course/dashboard and that your Cengage session is active.',
      });
    }

    return asToolResponse({
      status: 'ok',
      entryUrl,
      selectedCourse: mapCourseSummary(selectedCourse),
      assignments: assignmentRows,
    });
  } catch (error: unknown) {
    if (error instanceof CengageAuthRequiredError) {
      return asToolResponse({
        status: 'auth_required',
        entryUrl,
        assignments: [],
        message: `Cengage authentication required. Please log in at ${getAuthUrl('cengage')} and retry.`,
      });
    }

    if (error instanceof CengageError) {
      return asToolResponse({
        status: 'error',
        entryUrl,
        assignments: [],
        message: `${error.message} [${error.code}]`,
      });
    }

    if (error instanceof Error) {
      return asToolResponse({
        status: 'error',
        entryUrl,
        assignments: [],
        message: `Failed to fetch Cengage assignments: ${error.message}`,
      });
    }

    return asToolResponse({
      status: 'error',
      entryUrl,
      assignments: [],
      message: 'Failed to fetch Cengage assignments due to an unknown error.',
    });
  } finally {
    await scraper.close();
  }
}
