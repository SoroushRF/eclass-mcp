export interface CengageCourseLinkCandidate {
  href: string;
  text?: string;
  titleAttr?: string;
  ariaLabel?: string;
  dataCourseId?: string;
  dataCourseKey?: string;
}

export interface CengageDashboardCourse {
  courseId?: string;
  courseKey?: string;
  title: string;
  launchUrl: string;
  platform: 'webassign' | 'cengage';
  confidence: number;
}

export interface CengageCourseSelectionInput {
  courseId?: string;
  courseKey?: string;
  courseQuery?: string;
}

export type CengageCourseSelectionStrategy =
  | 'single'
  | 'course_id'
  | 'course_key'
  | 'exact_title'
  | 'normalized_title'
  | 'fuzzy_title';

export type CengageCourseSelectionStatus =
  | 'selected'
  | 'selection_required'
  | 'ambiguous'
  | 'not_found';

export interface CengageCourseSelectionResult {
  status: CengageCourseSelectionStatus;
  strategy?: CengageCourseSelectionStrategy;
  selectedCourse?: CengageDashboardCourse;
  candidates: CengageDashboardCourse[];
  message: string;
}

const GENERIC_TITLE_WORDS = new Set([
  'launch',
  'open',
  'enter',
  'continue',
  'start',
  'view',
  'go',
  'course',
  'class',
  'click',
  'here',
]);

function normalizeText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(candidateHref: string, baseUrl: string): URL | null {
  try {
    const parsed = new URL(candidateHref, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function isKnownPlatformHost(host: string): boolean {
  return (
    host.includes('webassign.net') ||
    host.includes('getenrolled.com') ||
    host.includes('cengage.com')
  );
}

function inferPlatform(host: string): 'webassign' | 'cengage' {
  return host.includes('cengage.com') ? 'cengage' : 'webassign';
}

function getCourseKey(
  url: URL,
  candidate: CengageCourseLinkCandidate
): string | undefined {
  const fromData = normalizeText(candidate.dataCourseKey);
  if (fromData) return fromData;

  const fromQuery = normalizeText(
    url.searchParams.get('courseKey') || undefined
  );
  if (fromQuery) return fromQuery;

  return undefined;
}

function getCourseId(
  url: URL,
  candidate: CengageCourseLinkCandidate
): string | undefined {
  const fromData = normalizeText(candidate.dataCourseId);
  if (fromData) return fromData;

  const queryKeys = ['courseId', 'courseid', 'cid', 'classId', 'classid'];
  for (const key of queryKeys) {
    const fromQuery = normalizeText(url.searchParams.get(key) || undefined);
    if (fromQuery) return fromQuery;
  }

  const pathMatch = url.pathname.match(
    /\/(courses?|classes?|sections?)\/([a-z0-9_-]{4,})/i
  );
  if (pathMatch?.[2]) {
    return pathMatch[2];
  }

  return undefined;
}

function looksLikeCourseLaunch(
  url: URL,
  courseId?: string,
  courseKey?: string
): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (courseId || courseKey) {
    return true;
  }

  if (host.includes('webassign.net')) {
    return (
      path.includes('/v4cgi/login.pl') ||
      path.includes('/web/student') ||
      path.includes('/v4cgi/student')
    );
  }

  if (host.includes('getenrolled.com')) {
    return !!courseKey;
  }

  return (
    path.includes('/mindtap') ||
    path.includes('/nglms') ||
    path.includes('/dashboard/course') ||
    path.includes('/course/')
  );
}

function isMeaningfulTitle(title: string): boolean {
  if (!title) return false;
  if (title.length < 4) return false;

  const normalized = title.toLowerCase();
  if (GENERIC_TITLE_WORDS.has(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1 && GENERIC_TITLE_WORDS.has(words[0])) {
    return false;
  }

  return true;
}

function pickTitle(
  candidate: CengageCourseLinkCandidate,
  url: URL,
  courseId?: string,
  courseKey?: string
): { title: string; meaningful: boolean } {
  const options = [
    normalizeText(candidate.text),
    normalizeText(candidate.titleAttr),
    normalizeText(candidate.ariaLabel),
  ].filter(Boolean);

  for (const option of options) {
    if (isMeaningfulTitle(option)) {
      return { title: option, meaningful: true };
    }
  }

  if (courseKey) {
    return { title: `WebAssign ${courseKey}`, meaningful: false };
  }

  if (courseId) {
    return { title: `Course ${courseId}`, meaningful: false };
  }

  const fromPath = normalizeText(
    decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
  );

  if (fromPath && isMeaningfulTitle(fromPath)) {
    return { title: fromPath, meaningful: true };
  }

  return { title: 'Untitled Course', meaningful: false };
}

function clampConfidence(value: number): number {
  return Number(Math.max(0.05, Math.min(0.99, value)).toFixed(2));
}

function scoreCourseConfidence(params: {
  platform: 'webassign' | 'cengage';
  hasCourseId: boolean;
  hasCourseKey: boolean;
  hasMeaningfulTitle: boolean;
  launchLike: boolean;
}): number {
  let score = 0.25;

  if (params.platform === 'webassign') score += 0.2;
  if (params.hasCourseKey) score += 0.35;
  if (params.hasCourseId) score += 0.2;
  if (params.hasMeaningfulTitle) score += 0.15;
  if (params.launchLike) score += 0.1;

  if (!params.hasMeaningfulTitle) score -= 0.1;

  return clampConfidence(score);
}

function buildIdentity(
  launchUrl: string,
  courseId?: string,
  courseKey?: string
): string {
  if (courseKey) return `key:${courseKey.toLowerCase()}`;
  if (courseId) return `id:${courseId.toLowerCase()}`;
  return `url:${launchUrl.toLowerCase()}`;
}

function shouldReplaceCourse(
  current: CengageDashboardCourse,
  incoming: CengageDashboardCourse
): boolean {
  if (incoming.confidence !== current.confidence) {
    return incoming.confidence > current.confidence;
  }

  const incomingTitle = incoming.title.length;
  const currentTitle = current.title.length;
  if (incomingTitle !== currentTitle) {
    return incomingTitle > currentTitle;
  }

  return incoming.launchUrl < current.launchUrl;
}

function normalizeComparableText(value: string | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortCoursesForSelection(
  courses: CengageDashboardCourse[]
): CengageDashboardCourse[] {
  return [...courses].sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    const titleOrder = a.title.localeCompare(b.title);
    if (titleOrder !== 0) return titleOrder;

    return a.launchUrl.localeCompare(b.launchUrl);
  });
}

function buildCandidatesSummary(courses: CengageDashboardCourse[]): string {
  return courses
    .slice(0, 5)
    .map((course) => {
      const tags: string[] = [];
      if (course.courseId) tags.push(`id=${course.courseId}`);
      if (course.courseKey) tags.push(`key=${course.courseKey}`);
      const suffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
      return `${course.title}${suffix}`;
    })
    .join('; ');
}

function resolveByExactCourseId(
  sortedCourses: CengageDashboardCourse[],
  rawCourseId: string
): CengageCourseSelectionResult {
  const wantedId = normalizeComparableText(rawCourseId);
  const matches = sortedCourses.filter(
    (course) => normalizeComparableText(course.courseId) === wantedId
  );

  if (matches.length === 1) {
    return {
      status: 'selected',
      strategy: 'course_id',
      selectedCourse: matches[0],
      candidates: matches,
      message: `Selected course by courseId '${rawCourseId}'.`,
    };
  }

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      strategy: 'course_id',
      candidates: matches,
      message:
        `Multiple courses matched courseId '${rawCourseId}'. ` +
        `Please specify courseKey or a more precise courseQuery. Candidates: ${buildCandidatesSummary(matches)}`,
    };
  }

  return {
    status: 'not_found',
    strategy: 'course_id',
    candidates: sortedCourses,
    message: `No course matched courseId '${rawCourseId}'.`,
  };
}

function resolveByExactCourseKey(
  sortedCourses: CengageDashboardCourse[],
  rawCourseKey: string
): CengageCourseSelectionResult {
  const wantedKey = normalizeComparableText(rawCourseKey);
  const matches = sortedCourses.filter(
    (course) => normalizeComparableText(course.courseKey) === wantedKey
  );

  if (matches.length === 1) {
    return {
      status: 'selected',
      strategy: 'course_key',
      selectedCourse: matches[0],
      candidates: matches,
      message: `Selected course by courseKey '${rawCourseKey}'.`,
    };
  }

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      strategy: 'course_key',
      candidates: matches,
      message:
        `Multiple courses matched courseKey '${rawCourseKey}'. ` +
        `Please specify courseId or a more precise courseQuery. Candidates: ${buildCandidatesSummary(matches)}`,
    };
  }

  return {
    status: 'not_found',
    strategy: 'course_key',
    candidates: sortedCourses,
    message: `No course matched courseKey '${rawCourseKey}'.`,
  };
}

function resolveByExactTitle(
  sortedCourses: CengageDashboardCourse[],
  rawQuery: string
): CengageCourseSelectionResult | null {
  const query = normalizeText(rawQuery).toLowerCase();
  if (!query) return null;

  const matches = sortedCourses.filter(
    (course) => normalizeText(course.title).toLowerCase() === query
  );

  if (matches.length === 1) {
    return {
      status: 'selected',
      strategy: 'exact_title',
      selectedCourse: matches[0],
      candidates: matches,
      message: `Selected course by exact title '${rawQuery}'.`,
    };
  }

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      strategy: 'exact_title',
      candidates: matches,
      message:
        `Multiple courses matched exact title '${rawQuery}'. ` +
        `Please specify courseId or courseKey. Candidates: ${buildCandidatesSummary(matches)}`,
    };
  }

  return null;
}

function resolveByNormalizedTitle(
  sortedCourses: CengageDashboardCourse[],
  rawQuery: string
): CengageCourseSelectionResult | null {
  const query = normalizeComparableText(rawQuery);
  if (!query) return null;

  const matches = sortedCourses.filter(
    (course) => normalizeComparableText(course.title) === query
  );

  if (matches.length === 1) {
    return {
      status: 'selected',
      strategy: 'normalized_title',
      selectedCourse: matches[0],
      candidates: matches,
      message: `Selected course by normalized title '${rawQuery}'.`,
    };
  }

  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      strategy: 'normalized_title',
      candidates: matches,
      message:
        `Multiple courses matched normalized title '${rawQuery}'. ` +
        `Please specify courseId or courseKey. Candidates: ${buildCandidatesSummary(matches)}`,
    };
  }

  return null;
}

interface ScoredCourseCandidate {
  course: CengageDashboardCourse;
  score: number;
}

function scoreFuzzyTitleMatch(
  course: CengageDashboardCourse,
  query: string,
  queryTokens: string[]
): number {
  const normalizedTitle = normalizeComparableText(course.title);
  if (!normalizedTitle) return 0;

  const titleTokens = new Set(normalizedTitle.split(' ').filter(Boolean));
  const overlap = queryTokens.filter((token) => titleTokens.has(token)).length;
  const overlapRatio =
    queryTokens.length > 0 ? overlap / queryTokens.length : 0;

  let score = 0;
  if (normalizedTitle.includes(query)) score += 0.6;
  if (normalizedTitle.startsWith(query)) score += 0.15;
  score += overlapRatio * 0.2;
  score += Math.min(0.05, course.confidence * 0.05);

  return Number(score.toFixed(4));
}

function resolveByFuzzyTitle(
  sortedCourses: CengageDashboardCourse[],
  rawQuery: string
): CengageCourseSelectionResult {
  const query = normalizeComparableText(rawQuery);
  const queryTokens = query.split(' ').filter(Boolean);

  const scored: ScoredCourseCandidate[] = sortedCourses
    .map((course) => ({
      course,
      score: scoreFuzzyTitleMatch(course, query, queryTokens),
    }))
    .filter((entry) => entry.score >= 0.55)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (b.course.confidence !== a.course.confidence) {
        return b.course.confidence - a.course.confidence;
      }

      return a.course.title.localeCompare(b.course.title);
    });

  if (scored.length === 0) {
    return {
      status: 'not_found',
      strategy: 'fuzzy_title',
      candidates: sortedCourses,
      message: `No course matched courseQuery '${rawQuery}'.`,
    };
  }

  const best = scored[0];
  const second = scored[1];

  if (!second || best.score - second.score >= 0.15) {
    return {
      status: 'selected',
      strategy: 'fuzzy_title',
      selectedCourse: best.course,
      candidates: [best.course],
      message: `Selected course by fuzzy title match '${rawQuery}'.`,
    };
  }

  const ambiguous = scored
    .filter((entry) => best.score - entry.score <= 0.15)
    .map((entry) => entry.course);

  return {
    status: 'ambiguous',
    strategy: 'fuzzy_title',
    candidates: ambiguous,
    message:
      `Course query '${rawQuery}' is ambiguous. ` +
      `Please refine courseQuery or specify courseId/courseKey. Candidates: ${buildCandidatesSummary(ambiguous)}`,
  };
}

export function resolveDashboardCourseSelection(
  courses: CengageDashboardCourse[],
  input: CengageCourseSelectionInput
): CengageCourseSelectionResult {
  const sortedCourses = sortCoursesForSelection(courses);
  const courseId = normalizeText(input.courseId);
  const courseKey = normalizeText(input.courseKey);
  const courseQuery = normalizeText(input.courseQuery);

  if (sortedCourses.length === 0) {
    return {
      status: 'not_found',
      candidates: [],
      message: 'No courses are available for selection.',
    };
  }

  if (courseId) {
    return resolveByExactCourseId(sortedCourses, courseId);
  }

  if (courseKey) {
    return resolveByExactCourseKey(sortedCourses, courseKey);
  }

  if (courseQuery) {
    const exactTitle = resolveByExactTitle(sortedCourses, courseQuery);
    if (exactTitle) return exactTitle;

    const normalizedTitle = resolveByNormalizedTitle(
      sortedCourses,
      courseQuery
    );
    if (normalizedTitle) return normalizedTitle;

    return resolveByFuzzyTitle(sortedCourses, courseQuery);
  }

  if (sortedCourses.length === 1) {
    return {
      status: 'selected',
      strategy: 'single',
      selectedCourse: sortedCourses[0],
      candidates: sortedCourses,
      message: 'Selected the only available course.',
    };
  }

  return {
    status: 'selection_required',
    candidates: sortedCourses,
    message:
      'Multiple courses are available. Provide courseId, courseKey, or courseQuery to choose one.',
  };
}

export function extractDashboardCourses(
  candidates: CengageCourseLinkCandidate[],
  baseUrl: string
): CengageDashboardCourse[] {
  const deduped = new Map<string, CengageDashboardCourse>();

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate.href, baseUrl);
    if (!normalized) continue;

    const host = normalized.hostname.toLowerCase();
    if (!isKnownPlatformHost(host)) continue;

    const platform = inferPlatform(host);
    const courseKey = getCourseKey(normalized, candidate);
    const courseId = getCourseId(normalized, candidate);
    const launchLike = looksLikeCourseLaunch(normalized, courseId, courseKey);
    if (!launchLike) continue;

    const titleInfo = pickTitle(candidate, normalized, courseId, courseKey);
    const launchUrl = normalized.toString();

    const course: CengageDashboardCourse = {
      title: titleInfo.title,
      launchUrl,
      platform,
      confidence: scoreCourseConfidence({
        platform,
        hasCourseId: !!courseId,
        hasCourseKey: !!courseKey,
        hasMeaningfulTitle: titleInfo.meaningful,
        launchLike,
      }),
    };

    if (courseId) course.courseId = courseId;
    if (courseKey) course.courseKey = courseKey;

    const identity = buildIdentity(launchUrl, courseId, courseKey);
    const existing = deduped.get(identity);
    if (!existing || shouldReplaceCourse(existing, course)) {
      deduped.set(identity, course);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    const titleOrder = a.title.localeCompare(b.title);
    if (titleOrder !== 0) return titleOrder;

    return a.launchUrl.localeCompare(b.launchUrl);
  });
}

export function inferCourseFromCurrentPage(
  pageUrl: string,
  pageTitle?: string
): CengageDashboardCourse | null {
  const normalized = normalizeUrl(pageUrl, pageUrl);
  if (!normalized) return null;

  const host = normalized.hostname.toLowerCase();
  if (!isKnownPlatformHost(host)) return null;

  const platform = inferPlatform(host);
  const courseKey = getCourseKey(normalized, { href: pageUrl });
  const courseId = getCourseId(normalized, { href: pageUrl });

  const titleInfo = pickTitle(
    {
      href: pageUrl,
      text: normalizeText(pageTitle),
      titleAttr: normalizeText(pageTitle),
    },
    normalized,
    courseId,
    courseKey
  );

  const launchLike = looksLikeCourseLaunch(normalized, courseId, courseKey);

  const result: CengageDashboardCourse = {
    title: titleInfo.title,
    launchUrl: normalized.toString(),
    platform,
    confidence: scoreCourseConfidence({
      platform,
      hasCourseId: !!courseId,
      hasCourseKey: !!courseKey,
      hasMeaningfulTitle: titleInfo.meaningful,
      launchLike,
    }),
  };

  if (courseId) result.courseId = courseId;
  if (courseKey) result.courseKey = courseKey;

  return result;
}
