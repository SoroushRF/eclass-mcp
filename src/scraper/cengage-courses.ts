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
  return host.includes('webassign.net') || host.includes('cengage.com');
}

function inferPlatform(host: string): 'webassign' | 'cengage' {
  return host.includes('webassign.net') ? 'webassign' : 'cengage';
}

function getCourseKey(url: URL, candidate: CengageCourseLinkCandidate): string | undefined {
  const fromData = normalizeText(candidate.dataCourseKey);
  if (fromData) return fromData;

  const fromQuery = normalizeText(url.searchParams.get('courseKey') || undefined);
  if (fromQuery) return fromQuery;

  return undefined;
}

function getCourseId(url: URL, candidate: CengageCourseLinkCandidate): string | undefined {
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

function looksLikeCourseLaunch(url: URL, courseId?: string, courseKey?: string): boolean {
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