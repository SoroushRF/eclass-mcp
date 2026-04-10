export interface CengageAssignmentRowCandidate {
  id?: string;
  href?: string;
  name?: string;
  dueDate?: string;
  score?: string;
  statusHint?: string;
  rowText: string;
}

export interface ParsedWebAssignAssignment {
  name: string;
  dueDate: string;
  score?: string;
  status: string;
  id?: string;
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

function inferDueDate(row: CengageAssignmentRowCandidate): string {
  const explicit = normalizeText(row.dueDate);
  if (explicit) return explicit;

  const rowText = normalizeText(row.rowText);
  const pattern =
    /(?:due\s*date[:\s]*)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?(?:\s+\d{1,2}:\d{2}\s*(?:am|pm)?)?)/i;
  const match = rowText.match(pattern);
  if (match?.[1]) {
    return normalizeText(match[1]);
  }

  return 'Unknown Date';
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
    /\bgraded\b|\bscore\b|\bpoints?\b|\bgrade\b/.test(combined) &&
    /\d/.test(combined)
  ) {
    return 'Graded';
  }

  if (/\bsubmitted\b|\bcompleted\b|\bdone\b/.test(combined)) {
    return 'Submitted';
  }

  return 'Pending';
}

function buildDedupeKey(row: CengageAssignmentRowCandidate): string {
  const id = normalizeText(row.id);
  if (id) return `id:${id.toLowerCase()}`;

  const href = normalizeText(row.href);
  if (href) return `href:${href.toLowerCase()}`;

  const name = normalizeText(row.name).toLowerCase();
  const dueDate = inferDueDate(row).toLowerCase();
  return `name:${name}|due:${dueDate}`;
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
  rows: CengageAssignmentRowCandidate[]
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
      rowText,
    };

    const key = buildDedupeKey(normalized);
    const existing = deduped.get(key);
    if (!existing || shouldReplaceCandidate(existing, normalized)) {
      deduped.set(key, normalized);
    }
  }

  return Array.from(deduped.values()).map((row) => ({
    id: normalizeText(row.id) || undefined,
    name: normalizeText(row.name),
    dueDate: inferDueDate(row),
    score: normalizeText(row.score) || undefined,
    status: inferStatus(row),
  }));
}