import type { MachineCode } from '../errors/codes';

/**
 * Thrown when Moodle/eClass HTML no longer matches selectors the scraper expects
 * (E12: machine code SCRAPE_LAYOUT_CHANGED).
 */
export class ScrapeLayoutError extends Error {
  readonly code = 'SCRAPE_LAYOUT_CHANGED' as const;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ScrapeLayoutError';
  }
}

/** E12 network / upstream failure codes surfaced to tools. */
export type UpstreamCode = Extract<
  MachineCode,
  'UPSTREAM_ERROR' | 'RATE_LIMITED' | 'TIMEOUT'
>;

/**
 * Thrown at HTTP/fetch/Playwright boundaries (E12: TIMEOUT, RATE_LIMITED, UPSTREAM_ERROR).
 */
export class UpstreamError extends Error {
  readonly code: UpstreamCode;

  constructor(
    code: UpstreamCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
  }
}

export function upstreamErrorFromHttpStatus(
  status: number,
  message: string
): UpstreamError {
  const code: UpstreamCode =
    status === 429
      ? 'RATE_LIMITED'
      : status === 408 || status === 504
        ? 'TIMEOUT'
        : 'UPSTREAM_ERROR';
  return new UpstreamError(code, message, status);
}

/**
 * Map unknown errors from fetch, Playwright, or parsers into {@link UpstreamError}.
 */
export function upstreamErrorFromUnknown(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error;
  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const lower = msg.toLowerCase();
  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout')
  ) {
    return new UpstreamError('TIMEOUT', msg, undefined, error);
  }
  if (
    msg.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return new UpstreamError('RATE_LIMITED', msg, undefined, error);
  }
  return new UpstreamError('UPSTREAM_ERROR', msg, undefined, error);
}
