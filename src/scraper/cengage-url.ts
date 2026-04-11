import { CengageInvalidInputError } from './cengage-errors';

export type CengageEntryLinkType =
  | 'eclass_lti'
  | 'webassign_course'
  | 'webassign_dashboard'
  | 'cengage_dashboard'
  | 'cengage_login'
  | 'other';

export interface CengageEntryClassification {
  rawInput: string;
  extractedUrl: string;
  normalizedUrl: string;
  linkType: CengageEntryLinkType;
  host: string;
  pathname: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'\])]+/i;

function normalizeCandidate(raw: string): string {
  return raw
    .trim()
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .replace(/&amp;/gi, '&')
    .replace(/[),.;!?]+$/, '');
}

function findUrlCandidate(input: string): string | null {
  const direct = normalizeCandidate(input);
  try {
    // If the whole input is already a URL, use it directly.
    const parsed = new URL(direct);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return direct;
    }
  } catch {
    // Fall through to regex extraction from mixed text.
  }

  const match = input.match(URL_PATTERN);
  if (!match) return null;
  return normalizeCandidate(match[0]);
}

export function classifyCengageUrl(url: URL): CengageEntryLinkType {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host.includes('eclass.yorku.ca') && path.includes('/mod/lti/view.php')) {
    return 'eclass_lti';
  }

  if (host.includes('webassign.net')) {
    const hasCourseKey = url.searchParams.has('courseKey');
    if (path.includes('/v4cgi/login.pl') && hasCourseKey) {
      return 'webassign_course';
    }

    if (path.includes('/web/student') || path.includes('/v4cgi/student')) {
      return 'webassign_dashboard';
    }

    if (path.includes('/v4cgi/login.pl')) {
      return 'webassign_course';
    }

    return 'other';
  }

  if (host.includes('getenrolled.com')) {
    if (url.searchParams.has('courseKey')) {
      return 'webassign_course';
    }

    return 'other';
  }

  if (host.includes('login.cengage.com')) {
    return 'cengage_login';
  }

  if (host.includes('cengage.com')) {
    if (
      path.includes('/login') ||
      path.includes('/signin') ||
      path.includes('/auth')
    ) {
      return 'cengage_login';
    }

    if (
      path.includes('dashboard') ||
      path.includes('/mindtap') ||
      path.includes('/nglms')
    ) {
      return 'cengage_dashboard';
    }

    return 'other';
  }

  return 'other';
}

export function normalizeAndClassifyCengageEntry(
  input: string
): CengageEntryClassification {
  const rawInput = input ?? '';
  const candidate = findUrlCandidate(rawInput);

  if (!candidate) {
    throw new CengageInvalidInputError(
      'No valid http/https URL found in the provided input.',
      { rawInput }
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new CengageInvalidInputError(
      'Invalid Cengage/WebAssign URL format.',
      {
        rawInput,
        candidate,
      }
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CengageInvalidInputError('URL protocol must be http or https.', {
      rawInput,
      candidate,
      protocol: parsed.protocol,
    });
  }

  // Ignore fragments for deterministic navigation and cache keys.
  parsed.hash = '';

  return {
    rawInput,
    extractedUrl: candidate,
    normalizedUrl: parsed.toString(),
    linkType: classifyCengageUrl(parsed),
    host: parsed.hostname.toLowerCase(),
    pathname: parsed.pathname,
  };
}
