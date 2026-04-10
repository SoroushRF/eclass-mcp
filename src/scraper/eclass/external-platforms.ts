export const EXTERNAL_PLATFORMS = {
  // LTI Link href patterns that specify an external tool in Moodle/eClass
  LTI_HREF: 'mod/lti/view.php',

  // CSS classes found on the link elements that trigger an LTI launch
  LTI_LINK_CLASSES: [
    'aalink stretched-link',
    'courseindex-link text-truncate',
    'autolink',
  ],

  // CSS classes on the parent container (useful if link class isn't enough)
  LTI_CONTAINER_CLASSES: ['modtype_lti'],

  // Text heuristics to identify specific platforms from link text or URL
  KEYWORDS: {
    CENGAGE: ['cengage', 'webassign', 'mindtap'],
    CROWDMARK: ['crowdmark'],
  },

  // Moodle activities that often wrap external links but are not LTI.
  URL_ACTIVITY_HREF: 'mod/url/view.php',
  RESOURCE_ACTIVITY_HREF: 'mod/resource/view.php',
};

export const OTHER_PLATFORMS = {
  // Add more external platform patterns here in the future
};

export type ExternalPlatformName = 'cengage' | 'crowdmark' | 'unknown_lti';

export type ExternalPlatformSignal =
  | 'lti'
  | 'keyword_url'
  | 'keyword_name'
  | 'url_activity'
  | 'resource_activity';

export interface ExternalPlatformCandidate {
  name: string;
  url: string;
  itemType?: string;
}

export interface ExternalPlatformMatch {
  name: ExternalPlatformName;
  url: string;
  signal: ExternalPlatformSignal;
}

function normalizeText(value: string): string {
  return (value || '').toLowerCase().trim();
}

export function normalizeExternalPlatformUrl(url: string): string {
  return (url || '').trim().replace(/#.*$/, '');
}

function hasAnyKeyword(haystack: string, keywords: string[]): boolean {
  return keywords.some((keyword) => haystack.includes(keyword));
}

function detectKnownPlatformName(
  lowerName: string,
  lowerUrl: string
): 'cengage' | 'crowdmark' | null {
  if (
    hasAnyKeyword(lowerName, EXTERNAL_PLATFORMS.KEYWORDS.CENGAGE) ||
    hasAnyKeyword(lowerUrl, EXTERNAL_PLATFORMS.KEYWORDS.CENGAGE)
  ) {
    return 'cengage';
  }

  if (
    hasAnyKeyword(lowerName, EXTERNAL_PLATFORMS.KEYWORDS.CROWDMARK) ||
    hasAnyKeyword(lowerUrl, EXTERNAL_PLATFORMS.KEYWORDS.CROWDMARK)
  ) {
    return 'crowdmark';
  }

  return null;
}

export function classifyExternalPlatformCandidate(
  candidate: ExternalPlatformCandidate
): ExternalPlatformMatch | null {
  const normalizedUrl = normalizeExternalPlatformUrl(candidate.url || '');
  if (!normalizedUrl) return null;

  const lowerUrl = normalizeText(normalizedUrl);
  const lowerName = normalizeText(candidate.name || '');
  const lowerType = normalizeText(candidate.itemType || '');

  const isLti =
    lowerType === 'lti' || lowerUrl.includes(EXTERNAL_PLATFORMS.LTI_HREF);
  const isUrlActivity =
    lowerType === 'url' ||
    lowerUrl.includes(EXTERNAL_PLATFORMS.URL_ACTIVITY_HREF);
  const isResourceActivity =
    lowerType === 'resource' ||
    lowerUrl.includes(EXTERNAL_PLATFORMS.RESOURCE_ACTIVITY_HREF);

  const known = detectKnownPlatformName(lowerName, lowerUrl);

  if (isLti) {
    return {
      name: known || 'unknown_lti',
      url: normalizedUrl,
      signal: 'lti',
    };
  }

  if (known) {
    if (
      hasAnyKeyword(lowerUrl, EXTERNAL_PLATFORMS.KEYWORDS.CENGAGE) ||
      hasAnyKeyword(lowerUrl, EXTERNAL_PLATFORMS.KEYWORDS.CROWDMARK)
    ) {
      return {
        name: known,
        url: normalizedUrl,
        signal: 'keyword_url',
      };
    }

    if (isUrlActivity) {
      return {
        name: known,
        url: normalizedUrl,
        signal: 'url_activity',
      };
    }

    if (isResourceActivity) {
      return {
        name: known,
        url: normalizedUrl,
        signal: 'resource_activity',
      };
    }

    return {
      name: known,
      url: normalizedUrl,
      signal: 'keyword_name',
    };
  }

  return null;
}
