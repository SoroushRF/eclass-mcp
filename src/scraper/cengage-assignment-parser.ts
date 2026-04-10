export interface CengageAssignmentRowCandidate {
  id?: string;
  href?: string;
  name?: string;
  dueDate?: string;
  score?: string;
  statusHint?: string;
  courseId?: string;
  courseKey?: string;
  courseTitle?: string;
  rowText: string;
}

export interface ParsedWebAssignAssignment {
  name: string;
  dueDate: string;
  dueDateIso?: string;
  dueDateRaw?: string;
  score?: string;
  status: string;
  id?: string;
  courseId?: string;
  courseTitle?: string;
  url?: string;
  rawText: string;
}

export interface ParseWebAssignAssignmentsOptions {
  courseId?: string;
  courseKey?: string;
  courseTitle?: string;
}

export const ASSIGNMENT_CONTAINER_SELECTORS = [
  '#js-student-myAssignmentsWrapper',
  '[id*="myAssignments"]',
  '[data-testid*="assignment"][data-testid*="container"]',
  '[data-testid="my-assignments"]',
  '[data-e2e*="assignment"]',
  '[aria-label*="Assignments"]',
] as const;

export const ASSIGNMENT_ROW_SELECTORS = [
  '[data-assignment-id]',
  '[data-testid*="assignment-row"]',
  '.assignment-row',
  'li[class*="assignment"]',
  'tr[class*="assignment"]',
  'li[role="row"]',
  'tr[role="row"]',
  'li',
  'tr',
] as const;

export const ASSIGNMENT_NAME_SELECTORS = [
  '[data-testid*="assignment-title"]',
  '.assignment-title',
  'a[href*="assignment"]',
  'a[href*="homework"]',
  'strong',
  'b',
  'h3',
  'h4',
  'td:first-child a',
  'td:first-child',
] as const;

export const ASSIGNMENT_DUE_DATE_SELECTORS = [
  '[data-testid*="due"]',
  '[class*="due"]',
  'time[datetime]',
  'time',
  'td[class*="date"]',
] as const;

export const ASSIGNMENT_SCORE_SELECTORS = [
  '[data-testid*="score"]',
  '[class*="score"]',
  '[class*="grade"]',
  'td[class*="score"]',
  'td[class*="grade"]',
] as const;

export const ASSIGNMENT_STATUS_SELECTORS = [
  '[data-testid*="status"]',
  '[class*="status"]',
  '[class*="submission"]',
  'td[class*="status"]',
] as const;

function normalizeText(value: string | undefined | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparableToken(value: string | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

interface ParsedDueDate {
  value: string;
  raw: string;
  iso?: string;
}

interface ParsedDateParts {
  year?: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  hasTime: boolean;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function normalizeYear(value: string): number {
  if (value.length === 2) {
    const shortYear = Number(value);
    return shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
  }
  return Number(value);
}

function to24Hour(hour: number, ampm?: string): number {
  if (!ampm) return hour;
  const normalized = ampm.toLowerCase();
  if (normalized === 'am') {
    return hour === 12 ? 0 : hour;
  }
  return hour === 12 ? 12 : hour + 12;
}

function isValidDateParts(parts: ParsedDateParts): boolean {
  if (parts.month < 1 || parts.month > 12) return false;
  if (parts.day < 1 || parts.day > 31) return false;
  if (parts.hour < 0 || parts.hour > 23) return false;
  if (parts.minute < 0 || parts.minute > 59) return false;

  if (!parts.year) return true;

  const test = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  );

  return (
    test.getUTCFullYear() === parts.year &&
    test.getUTCMonth() === parts.month - 1 &&
    test.getUTCDate() === parts.day
  );
}

function formatDateValue(parts: ParsedDateParts): string {
  if (!parts.year) {
    return `${pad2(parts.month)}-${pad2(parts.day)}`;
  }

  const date = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  if (!parts.hasTime) return date;
  return `${date} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function formatDateIso(parts: ParsedDateParts): string | undefined {
  if (!parts.year) return undefined;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:00`;
}

function buildParsedDueDate(
  raw: string,
  parts: ParsedDateParts
): ParsedDueDate {
  return {
    raw: normalizeText(raw),
    value: formatDateValue(parts),
    iso: formatDateIso(parts),
  };
}

function parseMonthNameDate(input: string): ParsedDueDate | null {
  const pattern =
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)?(\d{4})?(?:\s*(?:at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i;
  const match = input.match(pattern);
  if (!match) return null;

  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : undefined;
  const hasTime = !!match[4];
  const rawHour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const hour = hasTime ? to24Hour(rawHour, match[6]) : 0;

  const parts: ParsedDateParts = {
    year,
    month,
    day,
    hour,
    minute,
    hasTime,
  };

  if (!isValidDateParts(parts)) return null;
  return buildParsedDueDate(match[0], parts);
}

function parseIsoLikeDate(input: string): ParsedDueDate | null {
  const pattern =
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i;
  const match = input.match(pattern);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hasTime = !!match[4];
  const rawHour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const hour = hasTime ? to24Hour(rawHour, match[6]) : 0;

  const parts: ParsedDateParts = {
    year,
    month,
    day,
    hour,
    minute,
    hasTime,
  };

  if (!isValidDateParts(parts)) return null;
  return buildParsedDueDate(match[0], parts);
}

function parseSlashDate(input: string): ParsedDueDate | null {
  const pattern =
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i;
  const match = input.match(pattern);
  if (!match) return null;

  let month = Number(match[1]);
  let day = Number(match[2]);
  const year = normalizeYear(match[3]);
  if (month > 12 && day <= 12) {
    const temp = month;
    month = day;
    day = temp;
  }

  const hasTime = !!match[4];
  const rawHour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const hour = hasTime ? to24Hour(rawHour, match[6]) : 0;

  const parts: ParsedDateParts = {
    year,
    month,
    day,
    hour,
    minute,
    hasTime,
  };

  if (!isValidDateParts(parts)) return null;
  return buildParsedDueDate(match[0], parts);
}

function parseRelativeDate(input: string): ParsedDueDate | null {
  const pattern =
    /\b(today|tomorrow)\b(?:\s*(?:at)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i;
  const match = input.match(pattern);
  if (!match) return null;

  const now = new Date();
  const base = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + (match[1].toLowerCase() === 'tomorrow' ? 1 : 0)
  );

  const hasTime = !!match[2];
  const rawHour = match[2] ? Number(match[2]) : 0;
  const minute = match[3] ? Number(match[3]) : 0;
  const hour = hasTime ? to24Hour(rawHour, match[4]) : 0;

  const parts: ParsedDateParts = {
    year: base.getFullYear(),
    month: base.getMonth() + 1,
    day: base.getDate(),
    hour,
    minute,
    hasTime,
  };

  if (!isValidDateParts(parts)) return null;
  return buildParsedDueDate(match[0], parts);
}

function parseKnownDueDate(input: string): ParsedDueDate | null {
  const cleaned = normalizeText(input)
    .replace(/^due\s*date\s*[:-]?\s*/i, '')
    .replace(/^due\s*[:-]?\s*/i, '');

  if (!cleaned) return null;

  return (
    parseMonthNameDate(cleaned) ||
    parseIsoLikeDate(cleaned) ||
    parseSlashDate(cleaned) ||
    parseRelativeDate(cleaned)
  );
}

function inferDueDate(row: CengageAssignmentRowCandidate): ParsedDueDate {
  const explicit = normalizeText(row.dueDate);
  if (explicit) {
    const parsed = parseKnownDueDate(explicit);
    if (parsed) return parsed;
    return {
      raw: explicit,
      value: explicit,
    };
  }

  const rowText = normalizeText(row.rowText);
  const parsed = parseKnownDueDate(rowText);
  if (parsed) {
    return parsed;
  }

  return {
    raw: rowText,
    value: 'Unknown Date',
  };
}

function inferStatus(row: CengageAssignmentRowCandidate): string {
  const combined =
    `${normalizeText(row.statusHint)} ${normalizeText(row.rowText)}`.toLowerCase();

  if (
    /\bnot\s+submitted\b|\bmissing\b|\boverdue\b|\bpast\s+due\b|\bincomplete\b/.test(
      combined
    )
  ) {
    return 'Pending';
  }

  if (
    /\bin\s+progress\b|\bopen\b|\bavailable\b|\bnot\s+started\b/.test(combined)
  ) {
    return 'Pending';
  }

  if (
    (/\bgraded\b|\bgrade\s+posted\b|\bscore\b|\bpoints?\b|\bgrade\b/.test(
      combined
    ) &&
      /\d/.test(combined)) ||
    /\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\b/.test(combined)
  ) {
    return 'Graded';
  }

  if (
    /\bsubmitted\b|\bcompleted\b|\bturned\s+in\b|\bdone\b|\battempted\b/.test(
      combined
    )
  ) {
    return 'Submitted';
  }

  return 'Unknown';
}

function normalizeHrefForIdentity(href: string): string {
  const candidate = normalizeText(href);
  if (!candidate) return '';

  try {
    const parsed = new URL(candidate, 'https://placeholder.invalid');
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    const query = parsed.searchParams.toString();
    return `${path}${query ? `?${query}` : ''}`.toLowerCase();
  } catch {
    return candidate.toLowerCase().replace(/#.*$/, '');
  }
}

function extractAssignmentIdFromHref(href: string): string | undefined {
  const normalized = normalizeHrefForIdentity(href);
  if (!normalized) return undefined;

  const idPattern =
    /(?:assignment(?:id)?|homework(?:id)?|problemset(?:id)?|id)=([a-z0-9._-]+)/i;
  const queryMatch = normalized.match(idPattern);
  if (queryMatch?.[1]) {
    return queryMatch[1].toLowerCase();
  }

  const pathMatch = normalized.match(
    /\/(?:assignment|assignments|homework|problemset|problems?)\/(?:view\/)?([a-z0-9._-]{3,})/i
  );
  if (pathMatch?.[1]) {
    return pathMatch[1].toLowerCase();
  }

  return undefined;
}

function resolveCourseScope(
  row: CengageAssignmentRowCandidate,
  options?: ParseWebAssignAssignmentsOptions
): string {
  const explicitId = normalizeComparableToken(
    row.courseId || options?.courseId
  );
  if (explicitId) return `id:${explicitId}`;

  const explicitKey = normalizeComparableToken(
    row.courseKey || options?.courseKey
  );
  if (explicitKey) return `key:${explicitKey}`;

  return 'unknown';
}

function buildDedupeKey(
  row: CengageAssignmentRowCandidate,
  options?: ParseWebAssignAssignmentsOptions
): string {
  const courseScope = resolveCourseScope(row, options);
  const id = normalizeText(row.id);
  if (id) return `course:${courseScope}|id:${id.toLowerCase()}`;

  const hrefDerivedId = row.href
    ? extractAssignmentIdFromHref(row.href)
    : undefined;
  if (hrefDerivedId) {
    return `course:${courseScope}|href-id:${hrefDerivedId}`;
  }

  const href = normalizeText(row.href);
  if (href) {
    return `course:${courseScope}|href:${normalizeHrefForIdentity(href)}`;
  }

  const name = normalizeComparableToken(row.name);
  const dueDate = inferDueDate(row).value.toLowerCase();
  return `course:${courseScope}|name:${name}|due:${dueDate}`;
}

function shouldReplaceCandidate(
  current: CengageAssignmentRowCandidate,
  incoming: CengageAssignmentRowCandidate
): boolean {
  const currentName = normalizeText(current.name);
  const incomingName = normalizeText(incoming.name);
  if (incomingName.length !== currentName.length) {
    return incomingName.length > currentName.length;
  }

  const currentText = normalizeText(current.rowText);
  const incomingText = normalizeText(incoming.rowText);
  return incomingText.length > currentText.length;
}

export function parseWebAssignAssignments(
  rows: CengageAssignmentRowCandidate[],
  options?: ParseWebAssignAssignmentsOptions
): ParsedWebAssignAssignment[] {
  const deduped = new Map<string, CengageAssignmentRowCandidate>();

  for (const row of rows) {
    const name = normalizeText(row.name);
    const rowText = normalizeText(row.rowText);

    if (!name || !rowText) continue;
    if (name.toLowerCase() === 'unknown assignment') continue;

    const normalized: CengageAssignmentRowCandidate = {
      id: normalizeText(row.id) || undefined,
      href: normalizeText(row.href) || undefined,
      name,
      dueDate: normalizeText(row.dueDate) || undefined,
      score: normalizeText(row.score) || undefined,
      statusHint: normalizeText(row.statusHint) || undefined,
      courseId: normalizeText(row.courseId) || undefined,
      courseKey: normalizeText(row.courseKey) || undefined,
      courseTitle: normalizeText(row.courseTitle) || undefined,
      rowText,
    };

    const key = buildDedupeKey(normalized, options);
    const existing = deduped.get(key);
    if (!existing || shouldReplaceCandidate(existing, normalized)) {
      deduped.set(key, normalized);
    }
  }

  return Array.from(deduped.values()).map((row) => {
    const due = inferDueDate(row);
    const assignment: ParsedWebAssignAssignment = {
      id: normalizeText(row.id) || undefined,
      name: normalizeText(row.name),
      dueDate: due.value,
      dueDateIso: due.iso,
      dueDateRaw: due.raw,
      score: normalizeText(row.score) || undefined,
      status: inferStatus(row),
      rawText: normalizeText(row.rowText),
    };

    const courseId =
      normalizeText(row.courseId) || normalizeText(options?.courseId);
    if (courseId) {
      assignment.courseId = courseId;
    }

    const courseTitle =
      normalizeText(row.courseTitle) || normalizeText(options?.courseTitle);
    if (courseTitle) {
      assignment.courseTitle = courseTitle;
    }

    const href = normalizeText(row.href);
    if (href) {
      assignment.url = href;
    }

    return assignment;
  });
}
