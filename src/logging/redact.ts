/**
 * Best-effort scrub of cookie-like substrings from free-form log text (URLs, raw headers, etc.).
 */
const SENSITIVE_QUERY_KEYS = new Set([
  'sesskey',
  'wstoken',
  'token',
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

  // Set-Cookie / Cookie header lines
  out = out.replace(/\b(Set-Cookie|Cookie)\s*:\s*[^\n]*/gi, '$1: [Redacted]');

  // Common sensitive URL query params
  out = redactUrlQueryParams(out);
  out = out.replace(
    /\b(sesskey|wstoken|token|auth|code|state|key|UserPass|password|pass|secret|SAMLResponse|RelayState)=[^&\s#'"]+/gi,
    '$1=[Redacted]'
  );

  // sessionid=... style
  out = out.replace(
    /\b(sessionid|MoodleSession[a-zA-Z0-9_]*)=([^&\s#'"]+)/gi,
    '$1=[Redacted]'
  );

  return out;
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
