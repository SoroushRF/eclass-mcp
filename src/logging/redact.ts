/**
 * Best-effort scrub of cookie-like substrings from free-form log text (URLs, raw headers, etc.).
 */
const SENSITIVE_QUERY_KEYS = new Set([
  'authorization',
  'cookie',
  'location',
  'set-cookie',
  'sesskey',
  'wstoken',
  'token',
  'passport',
  'mobiletoken',
  'access_token',
  'refresh_token',
  'auth',
  'code',
  'state',
  'key',
  'userpass',
  'password',
  'pass',
  'secret',
  'samlresponse',
  'relaystate',
]);

const SENSITIVE_LOG_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'location',
  'setcookie',
  'sesskey',
  'wstoken',
  'token',
  'passport',
  'mobiletoken',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'requestbody',
  'responsebody',
  'body',
]);

export const REDACTED_VALUE = '[Redacted]';

function normalizedLogKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_LOG_KEYS.has(normalizedLogKey(key));
}

function redactUrlQueryParams(message: string): string {
  return message.replace(
    /([?&])([^=\s&#'"]+)=([^&\s#'"]*)/g,
    (match, sep, key) =>
      SENSITIVE_QUERY_KEYS.has(String(key).toLowerCase())
        ? `${sep}${key}=[Redacted]`
        : match
  );
}

export function redactCookieSubstrings(message: string): string {
  if (!message) return message;

  let out = message;

  // Authorization, redirect, and cookie header lines
  out = out.replace(
    /\b(Authorization|Location|Set-Cookie|Cookie)\s*:\s*[^\n]*/gi,
    `$1: ${REDACTED_VALUE}`
  );

  // Common sensitive URL query params
  out = redactUrlQueryParams(out);
  out = out.replace(
    /\b(sesskey|wstoken|token|auth|code|state|key|UserPass|password|pass|secret|SAMLResponse|RelayState|passport|mobile_token|access_token|refresh_token)=[^&\s#'"]+/gi,
    `$1=${REDACTED_VALUE}`
  );

  // sessionid=... style
  out = out.replace(
    /\b(sessionid|MoodleSession[a-zA-Z0-9_]*)=([^&\s#'"]+)/gi,
    `$1=${REDACTED_VALUE}`
  );

  return out;
}

function redactStructuredValue(value: unknown, parentKey?: string): unknown {
  if (parentKey && isSensitiveLogKey(parentKey)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    return redactCookieSubstrings(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactStructuredValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code;
    return {
      name: value.name,
      ...(typeof code === 'string' ? { code } : {}),
    };
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      redactStructuredValue(item, key),
    ])
  );
}

/** Redacts credential-bearing fields before passing structured data to a logger. */
export function redactStructuredLogFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  return redactStructuredValue(fields) as Record<string, unknown>;
}

export function redactUrlForLog(rawUrl: string): string {
  const input = String(rawUrl ?? '');
  try {
    const url = new URL(input);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[Redacted]');
      }
    }
    if (url.username) url.username = '[Redacted]';
    if (url.password) url.password = '[Redacted]';
    return url.toString();
  } catch {
    return redactCookieSubstrings(input);
  }
}

/** Alias for call sites that want a clear name when logging user-controlled strings. */
export const safeString = redactCookieSubstrings;
