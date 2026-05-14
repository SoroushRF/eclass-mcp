/**
 * Machine-readable error codes (E12). Add new values here when introducing
 * new failure classes; keep strings stable for hosts and tests.
 */
export const MACHINE_CODES = [
  'SESSION_EXPIRED',
  'SESSION_STORAGE_UNAVAILABLE',
  'SCRAPE_LAYOUT_CHANGED',
  'UPSTREAM_ERROR',
  'RATE_LIMITED',
  'TIMEOUT',
  'VALIDATION_FAILED',
  'COURSE_CONTEXT_MISMATCH',
  'INTERNAL_ERROR',
] as const;

export type MachineCode = (typeof MACHINE_CODES)[number];

export function isMachineCode(value: unknown): value is MachineCode {
  return (
    typeof value === 'string' &&
    (MACHINE_CODES as readonly string[]).includes(value)
  );
}
