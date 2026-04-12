/**
 * Best-effort scrub of cookie-like substrings from free-form log text (URLs, raw headers, etc.).
 */
export function redactCookieSubstrings(message: string): string {
  if (!message) return message;

  let out = message;

  // Set-Cookie / Cookie header lines
  out = out.replace(/\b(Set-Cookie|Cookie)\s*:\s*[^\n]*/gi, '$1: [Redacted]');

  // Common Moodle query params
  out = out.replace(/\bsesskey=[^&\s#'"]+/gi, 'sesskey=[Redacted]');
  out = out.replace(/\bwstoken=[^&\s#'"]+/gi, 'wstoken=[Redacted]');

  // sessionid=... style
  out = out.replace(
    /\b(sessionid|MoodleSession[a-zA-Z0-9_]*)=([^&\s#'"]+)/gi,
    '$1=[Redacted]'
  );

  return out;
}

/** Alias for call sites that want a clear name when logging user-controlled strings. */
export const safeString = redactCookieSubstrings;
