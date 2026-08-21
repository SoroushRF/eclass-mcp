import type { MachineCode } from '../../../errors/codes';

export type MoodleApiErrorCategory =
  | 'capability_unavailable'
  | 'session_invalid'
  | 'mobile_token_invalid'
  | 'malformed_response'
  | 'timeout'
  | 'rate_limited'
  | 'upstream';

export interface MoodleApiErrorOptions {
  category: MoodleApiErrorCategory;
  status?: number;
  upstreamCode?: string;
  publicCode?: Extract<
    MachineCode,
    'SESSION_EXPIRED' | 'UPSTREAM_ERROR' | 'RATE_LIMITED' | 'TIMEOUT'
  >;
  cause?: unknown;
}

type MoodlePublicCode = NonNullable<MoodleApiErrorOptions['publicCode']>;

function defaultPublicCode(
  category: MoodleApiErrorCategory
): MoodlePublicCode {
  switch (category) {
    case 'session_invalid':
      return 'SESSION_EXPIRED';
    case 'timeout':
      return 'TIMEOUT';
    case 'rate_limited':
      return 'RATE_LIMITED';
    default:
      return 'UPSTREAM_ERROR';
  }
}

function defaultMessage(category: MoodleApiErrorCategory): string {
  switch (category) {
    case 'capability_unavailable':
      return 'The requested Moodle capability is not available through this gateway.';
    case 'session_invalid':
      return 'The eClass session is no longer valid.';
    case 'mobile_token_invalid':
      return 'The Moodle mobile credential is no longer valid.';
    case 'malformed_response':
      return 'Moodle returned an invalid response.';
    case 'timeout':
      return 'Moodle did not respond before the API timeout.';
    case 'rate_limited':
      return 'Moodle temporarily rate-limited the API request.';
    case 'upstream':
      return 'The Moodle API request failed.';
  }
}

export class MoodleApiError extends Error {
  readonly category: MoodleApiErrorCategory;
  readonly status?: number;
  readonly upstreamCode?: string;
  readonly publicCode: MoodlePublicCode;

  constructor(options: MoodleApiErrorOptions) {
    super(defaultMessage(options.category));
    this.name = 'MoodleApiError';
    this.category = options.category;
    this.status = options.status;
    this.upstreamCode = options.upstreamCode;
    this.publicCode = options.publicCode ?? defaultPublicCode(options.category);
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isMoodleApiError(value: unknown): value is MoodleApiError {
  return value instanceof MoodleApiError;
}

export function classifyHttpStatus(status: number): MoodleApiErrorCategory {
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limited';
  return 'upstream';
}
