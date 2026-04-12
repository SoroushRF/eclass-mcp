import { createHash } from 'crypto';
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
import { getAuthUrl, openAuthWindow } from '../auth/server';
import { attachCacheMeta, cache, getCacheKey, TTL } from '../cache/store';
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
const CENGAGE_DISCOVERY_TTL_MINUTES = TTL.CONTENT;
const CENGAGE_LIST_COURSES_TTL_MINUTES = TTL.CONTENT;
const CENGAGE_ASSIGNMENTS_TTL_MINUTES = TTL.DEADLINES;
const CENGAGE_SESSION_BOOTSTRAP_CACHE_KEY = '__dashboard_session__';
const CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY = getCacheKey(
  'cengage',
  'dashboard_inventory',
  'session'
);

type DiscoveredLinkItem = DiscoverCengageLinksResponse['links'][number];

function createCacheDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cengageCacheKey(scope: string, value: unknown): string {
  return getCacheKey('cengage', scope, createCacheDigest(value));
}

function toCacheHitMeta(cached: {
  fetched_at: string;
  expires_at: string;
  stale?: boolean;
}) {
  return {
    hit: true,
    fetched_at: cached.fetched_at,
    expires_at: cached.expires_at,
    ...(cached.stale ? { stale: true } : {}),
  };
}

function toCacheMissMeta(ttlMinutes: number) {
  const now = new Date();
  return {
    hit: false,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMinutes * 60000).toISOString(),
  };
}

function withCacheMeta<T extends Record<string, unknown>>(
  payload: T,
  meta: {
    hit: boolean;
    fetched_at: string;
    expires_at: string;
    stale?: boolean;
  }
): T & {
  _cache: {
    hit: boolean;
    fetched_at: string;
    expires_at: string;
    stale?: boolean;
  };
} {
  return attachCacheMeta(payload, meta) as unknown as T & {
    _cache: {
      hit: boolean;
      fetched_at: string;
      expires_at: string;
      stale?: boolean;
    };
  };
}

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
    host.includes('getenrolled.com') ||
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

  if (input.sourceFile?.fileName) {
    parts.push(`file:${input.sourceFile.fileName}`);
  }

  if (input.sourceFile?.fileUrl) {
    parts.push(`fileUrl:${input.sourceFile.fileUrl}`);
  }

  if (input.sourceFile?.fileType) {
    parts.push(`fileType:${input.sourceFile.fileType}`);
  }

  if (typeof input.sourceFile?.blockIndex === 'number') {
    parts.push(`block:${input.sourceFile.blockIndex}`);
  }

  return parts.join(' ');
}

function buildSourceFileMetadata(input: DiscoverCengageLinksInput) {
  const sourceFile = input.sourceFile;
  if (!sourceFile) {
    return undefined;
  }

  const metadata: NonNullable<DiscoveredLinkItem['sourceFile']> = {
    fileName: sourceFile.fileName,
    fileUrl: sourceFile.fileUrl,
    fileType: sourceFile.fileType,
    blockIndex: sourceFile.blockIndex,
  };

  if (
    metadata.fileName ||
    metadata.fileUrl ||
    metadata.fileType ||
    typeof metadata.blockIndex === 'number'
  ) {
    return metadata;
  }

  return undefined;
}

function upsertDiscoveredLink(
  links: Map<string, DiscoveredLinkItem>,
  item: DiscoveredLinkItem
) {
  const key = `${item.normalizedUrl}|${item.source}`;
  const existing = links.get(key);
  if (!existing || (item.confidence || 0) > (existing.confidence || 0)) {
    links.set(key, item);
  }
}

export function discoverCengageLinksFromText(
  input: DiscoverCengageLinksInput
): DiscoverCengageLinksResponse {
  const source = input.source || 'manual';
  const links = new Map<string, DiscoveredLinkItem>();

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

      const sourceFile = buildSourceFileMetadata(input);

      const item: DiscoveredLinkItem = {
        rawUrl: candidate,
        normalizedUrl: classification.normalizedUrl,
        linkType: classification.linkType,
        source,
        sourceHint: buildSourceHint(input.text, match.index, input),
        confidence: calculateLinkConfidence(classification.linkType),
        ...(sourceFile ? { sourceFile } : {}),
      };

      upsertDiscoveredLink(links, item);
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

export interface DiscoverCengageLinksFromFileBlocksInput {
  blocks: Array<{
    type?: string;
    text?: string;
  }>;
  sourceFile?: {
    fileName?: string;
    fileUrl?: string;
    fileType?: 'pdf' | 'docx' | 'pptx' | 'other';
  };
  courseId?: string;
}

export function discoverCengageLinksFromFileBlocks(
  input: DiscoverCengageLinksFromFileBlocksInput
): DiscoverCengageLinksResponse {
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const mined = new Map<string, DiscoveredLinkItem>();

  blocks.forEach((block, blockIndex) => {
    if (!block || (block.type && block.type !== 'text')) {
      return;
    }

    const text = (block.text || '').trim();
    if (!text) {
      return;
    }

    const blockResult = discoverCengageLinksFromText({
      text,
      source: 'file_text',
      courseId: input.courseId,
      sourceFile: {
        fileName: input.sourceFile?.fileName,
        fileUrl: input.sourceFile?.fileUrl,
        fileType: input.sourceFile?.fileType,
        blockIndex,
      },
    });

    if (blockResult.status !== 'ok') {
      return;
    }

    for (const link of blockResult.links) {
      upsertDiscoveredLink(mined, link);
    }
  });

  const links = Array.from(mined.values());
  if (links.length === 0) {
    return {
      status: 'no_data',
      links: [],
      message:
        'No Cengage/WebAssign links were detected in the provided file text blocks.',
    };
  }

  return {
    status: 'ok',
    links,
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

function resolveListingEntryUrl(
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

function toRetryInputRecord(input: Record<string, unknown>) {
  const trimmedEntries = Object.entries(input).filter(
    ([, value]) => value !== undefined && value !== null && value !== ''
  );
  return Object.fromEntries(trimmedEntries);
}

function mapAuthReason(
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
    return asToolResponse(withCacheMeta(cached.data, toCacheHitMeta(cached)));
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
      return asToolResponse(
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
      return asToolResponse(
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
      return asToolResponse(
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
    return asToolResponse(
      withCacheMeta(payload, toCacheMissMeta(CENGAGE_ASSIGNMENTS_TTL_MINUTES))
    );
  } catch (error: unknown) {
    if (error instanceof CengageAuthRequiredError) {
      const authUrl = getAuthUrl('cengage');
      openAuthWindow('cengage');

      return asToolResponse({
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
    if (scraper) {
      await scraper.close();
    }
  }
}
