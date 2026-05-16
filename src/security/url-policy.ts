import { ValidationError } from '../errors/validation-error';
import { redactUrlForLog } from '../logging/redact';

export { redactUrlForLog } from '../logging/redact';

export type UrlPolicy =
  | 'eclass_file'
  | 'eclass_section'
  | 'eclass_item'
  | 'eclass_attachment'
  | 'cengage_entry'
  | 'cengage_page'
  | 'discovery_metadata';

type UrlCheckResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string; host?: string };

const ECLASS_HOST = 'eclass.yorku.ca';
const CENGAGE_HOSTS = new Set([
  ECLASS_HOST,
  'login.cengage.com',
  'www.cengage.com',
  'www.cengage.ca',
  'www.webassign.net',
  'www.getenrolled.com',
]);

const ECLASS_FILE_PATHS = [
  '/pluginfile.php',
  '/webservice/pluginfile.php',
  '/mod/resource/view.php',
  '/mod/folder/view.php',
  '/mod/url/view.php',
];

function trimQueryValues(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    const trimmed = value.trim();
    if (trimmed === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, trimmed);
    }
  }
}

function normalizeHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function parseIpv4(host: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isLocalOrPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipv4 = parseIpv4(host);
  if (ipv4) return true;

  if (host.includes(':')) return true;
  return false;
}

function pathStartsWith(pathname: string, allowed: readonly string[]): boolean {
  const path = pathname.toLowerCase();
  return allowed.some((prefix) => path.startsWith(prefix));
}

function isAllowedEclassFilePath(pathname: string): boolean {
  return pathStartsWith(pathname, ECLASS_FILE_PATHS);
}

function isAllowedCengageEntry(url: URL): boolean {
  const host = normalizeHost(url.hostname);
  const path = url.pathname.toLowerCase();

  if (host === ECLASS_HOST) {
    return path === '/mod/lti/view.php';
  }

  if (host === 'www.webassign.net') {
    return (
      path.startsWith('/v4cgi/login.pl') ||
      path.startsWith('/v4cgi/student') ||
      path.startsWith('/web/student')
    );
  }

  if (host === 'www.getenrolled.com') {
    return url.searchParams.has('courseKey');
  }

  if (host === 'login.cengage.com') {
    return true;
  }

  if (host === 'www.cengage.com' || host === 'www.cengage.ca') {
    return (
      path === '/' ||
      path.includes('/login') ||
      path.includes('/signin') ||
      path.includes('/auth') ||
      path.includes('dashboard') ||
      path.includes('/mindtap') ||
      path.includes('/nglms')
    );
  }

  return false;
}

function isAllowedCengagePage(url: URL): boolean {
  const host = normalizeHost(url.hostname);
  return (
    host === 'login.cengage.com' ||
    host === 'www.cengage.com' ||
    host === 'www.cengage.ca' ||
    host === 'www.webassign.net' ||
    host === 'www.getenrolled.com'
  );
}

function isAllowedByPolicy(url: URL, policy: UrlPolicy): boolean {
  const host = normalizeHost(url.hostname);
  const path = url.pathname;

  switch (policy) {
    case 'eclass_file':
    case 'eclass_attachment':
      return host === ECLASS_HOST && isAllowedEclassFilePath(path);
    case 'eclass_section':
      return host === ECLASS_HOST && path.toLowerCase() === '/course/view.php';
    case 'eclass_item':
      return (
        host === ECLASS_HOST &&
        (path.toLowerCase().startsWith('/mod/assign/') ||
          path.toLowerCase().startsWith('/mod/quiz/'))
      );
    case 'cengage_entry':
      return CENGAGE_HOSTS.has(host) && isAllowedCengageEntry(url);
    case 'cengage_page':
      return isAllowedCengagePage(url);
    case 'discovery_metadata':
      return true;
  }
}

function checkUrl(rawUrl: string, policy: UrlPolicy): UrlCheckResult {
  const input = (rawUrl ?? '').trim();
  if (!input) return { ok: false, reason: 'empty_url' };

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  const host = normalizeHost(parsed.hostname);

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol', host };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'embedded_credentials', host };
  }

  if (isLocalOrPrivateHost(host)) {
    return { ok: false, reason: 'local_or_private_host', host };
  }

  trimQueryValues(parsed);
  parsed.hash = '';

  if (!isAllowedByPolicy(parsed, policy)) {
    return { ok: false, reason: 'policy_denied', host };
  }

  return { ok: true, url: parsed };
}

function validationDetails(
  rawUrl: string,
  policy: UrlPolicy,
  reason: string,
  host?: string
) {
  return {
    field: 'url',
    policy,
    ...(host ? { host } : {}),
    reason,
    url: redactUrlForLog(rawUrl),
  };
}

export function validateUrlForPolicy(
  rawUrl: string,
  policy: UrlPolicy
): string {
  const result = checkUrl(rawUrl, policy);
  if (!result.ok) {
    throw new ValidationError(
      'URL is not allowed for this tool',
      validationDetails(rawUrl, policy, result.reason, result.host)
    );
  }
  return result.url.toString();
}

export function validateFinalUrlForPolicy(
  finalUrl: string,
  policy: UrlPolicy
): string {
  return validateUrlForPolicy(finalUrl, policy);
}

export function isAllowedUrlForPolicy(
  rawUrl: string,
  policy: UrlPolicy
): boolean {
  return checkUrl(rawUrl, policy).ok;
}
