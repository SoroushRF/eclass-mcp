export const ECLASS_DEFAULT_ORIGIN = 'https://eclass.yorku.ca';
export const ECLASS_AJAX_PATH = '/lib/ajax/service.php';
export const ECLASS_REST_PATH = '/webservice/rest/server.php';
export const ECLASS_MOBILE_LAUNCH_PATH = '/admin/tool/mobile/launch.php';

export const ECLASS_AJAX_METHODS = {
  enrolledCourses:
    'core_course_get_enrolled_courses_by_timeline_classification',
  courseFormatState: 'core_courseformat_get_state',
  calendarUpcoming: 'core_calendar_get_calendar_upcoming_view',
  calendarActionEvents: 'core_calendar_get_action_events_by_timesort',
  calendarMonthly: 'core_calendar_get_calendar_monthly_view',
} as const;

export type EclassSourceMode = 'playwright' | 'shadow' | 'api';

export const DEFAULT_ECLASS_SOURCE_MODE: EclassSourceMode = 'playwright';
export const DEFAULT_ECLASS_API_TIMEOUT_MS = 15_000;
export const MAX_ECLASS_API_TIMEOUT_MS = 60_000;

export interface EclassApiConfig {
  origin: string;
  sourceMode: EclassSourceMode;
  timeoutMs: number;
}

function resolveOrigin(rawValue: string | undefined): string {
  const raw = rawValue?.trim() || ECLASS_DEFAULT_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ECLASS_URL must be a valid absolute URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('ECLASS_URL must use HTTPS.');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('ECLASS_URL must not contain credentials or query data.');
  }

  return url.origin;
}

export function parseEclassSourceMode(
  rawValue: string | undefined
): EclassSourceMode {
  const value = (rawValue?.trim() || DEFAULT_ECLASS_SOURCE_MODE).toLowerCase();
  if (value === 'playwright' || value === 'shadow' || value === 'api') {
    return value;
  }
  throw new Error(
    `ECLASS_API_SOURCE_MODE must be one of: playwright, shadow, api. Received: ${value}`
  );
}

export function parseEclassApiTimeoutMs(rawValue: string | undefined): number {
  if (!rawValue?.trim()) return DEFAULT_ECLASS_API_TIMEOUT_MS;

  const value = Number(rawValue);
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_ECLASS_API_TIMEOUT_MS
  ) {
    throw new Error(
      `ECLASS_API_TIMEOUT_MS must be an integer between 1 and ${MAX_ECLASS_API_TIMEOUT_MS}.`
    );
  }
  return value;
}

export function getEclassApiConfig(
  env: NodeJS.ProcessEnv = process.env
): EclassApiConfig {
  return {
    origin: resolveOrigin(env.ECLASS_URL),
    sourceMode: parseEclassSourceMode(env.ECLASS_API_SOURCE_MODE),
    timeoutMs: parseEclassApiTimeoutMs(env.ECLASS_API_TIMEOUT_MS),
  };
}
