import type { APIRequestContext } from 'playwright';
import { getLogger } from '../../../logging/context';
import {
  createSafeApiLogFields,
  serializeApiErrorForLog,
} from '../../../logging/api-safe';
import {
  ECLASS_AJAX_PATH,
  ECLASS_REST_PATH,
} from './constants';
import {
  classifyHttpStatus,
  MoodleApiError,
  type MoodleApiErrorCategory,
} from './errors';
import {
  MoodleAjaxCallSchema,
  type MoodleAjaxCall,
} from './types';

export interface MoodleTransport {
  postAjax(
    calls: readonly MoodleAjaxCall[],
    sesskey: string
  ): Promise<unknown>;

  postRest(
    functionName: string,
    args: Record<string, unknown>,
    token: string
  ): Promise<unknown>;
}

export interface PlaywrightMoodleTransportOptions {
  request: APIRequestContext;
  origin: string;
  timeoutMs: number;
  maxResponseBytes?: number;
}

export const DEFAULT_MOODLE_RESPONSE_BYTES = 2 * 1024 * 1024;

function assertOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new MoodleApiError({ category: 'upstream' });
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new MoodleApiError({ category: 'upstream' });
  }
  return parsed.origin;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function appendRestArgument(
  params: URLSearchParams,
  key: string,
  value: unknown
): void {
  if (value === undefined || value === null) {
    params.set(key, '');
    return;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    params.set(key, String(value));
    return;
  }
  if (typeof value === 'boolean') {
    params.set(key, value ? '1' : '0');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendRestArgument(params, `${key}[${index}]`, item);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      appendRestArgument(params, `${key}[${childKey}]`, childValue);
    }
  }
}

export class PlaywrightMoodleTransport implements MoodleTransport {
  private readonly request: APIRequestContext;
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: PlaywrightMoodleTransportOptions) {
    this.request = options.request;
    this.origin = assertOrigin(options.origin);
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_MOODLE_RESPONSE_BYTES;
  }

  async postAjax(
    calls: readonly MoodleAjaxCall[],
    sesskey: string
  ): Promise<unknown> {
    if (!sesskey.trim()) {
      throw new MoodleApiError({ category: 'session_invalid' });
    }
    const parsedCalls = calls.map((call) =>
      MoodleAjaxCallSchema.parse(call)
    );
    const endpoint = new URL(ECLASS_AJAX_PATH, this.origin);
    endpoint.searchParams.set('sesskey', sesskey);

    return this.postJson(
      endpoint.toString(),
      JSON.stringify(parsedCalls),
      ECLASS_AJAX_PATH,
      'ajax.batch'
    );
  }

  async postRest(
    functionName: string,
    args: Record<string, unknown>,
    token: string
  ): Promise<unknown> {
    if (!token.trim()) {
      throw new MoodleApiError({ category: 'mobile_token_invalid' });
    }
    if (!/^[a-z][a-z0-9_]*$/.test(functionName)) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }

    const params = new URLSearchParams();
    params.set('wstoken', token);
    params.set('wsfunction', functionName);
    params.set('moodlewsrestformat', 'json');
    for (const [key, value] of Object.entries(args)) {
      appendRestArgument(params, key, value);
    }

    return this.postForm(
      new URL(ECLASS_REST_PATH, this.origin).toString(),
      params.toString(),
      ECLASS_REST_PATH,
      functionName
    );
  }

  private async postJson(
    url: string,
    body: string,
    endpointPath: string,
    operation: string
  ): Promise<unknown> {
    return this.executeRequest(
      endpointPath,
      operation,
      () =>
        this.request.post(url, {
          headers: { 'Content-Type': 'application/json' },
          data: body,
          timeout: this.timeoutMs,
        })
    );
  }

  private async postForm(
    url: string,
    body: string,
    endpointPath: string,
    operation: string
  ): Promise<unknown> {
    return this.executeRequest(
      endpointPath,
      operation,
      () =>
        this.request.post(url, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          data: body,
          timeout: this.timeoutMs,
        })
    );
  }

  private async executeRequest(
    endpointPath: string,
    operation: string,
    send: () => ReturnType<APIRequestContext['post']>
  ): Promise<unknown> {
    const startedAt = Date.now();
    let status: number | undefined;
    let responseBytes: number | undefined;

    try {
      const response = await send();
      status = response.status();
      const body = await response.body();
      responseBytes = body.byteLength;

      if (responseBytes > this.maxResponseBytes) {
        throw new MoodleApiError({ category: 'malformed_response', status });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString('utf8')) as unknown;
      } catch (cause) {
        throw new MoodleApiError({
          category: 'malformed_response',
          status,
          cause,
        });
      }

      if (status === 401 || status === 403) {
        throw new MoodleApiError({
          category: 'session_invalid',
          status,
        });
      }
      if (status < 200 || status >= 300) {
        const category: MoodleApiErrorCategory = classifyHttpStatus(status);
        throw new MoodleApiError({ category, status });
      }

      getLogger().info(
        createSafeApiLogFields({
          operation,
          source: 'api',
          endpointPath,
          status,
          durationMs: Date.now() - startedAt,
          responseBytes,
        }),
        'Moodle API request completed'
      );
      return parsed;
    } catch (error) {
      const normalized =
        error instanceof MoodleApiError
          ? error
          : new MoodleApiError({
              category: isTimeoutError(error) ? 'timeout' : 'upstream',
              status,
              cause: error,
            });
      const safeError = serializeApiErrorForLog(normalized);
      getLogger().warn(
        createSafeApiLogFields({
          operation,
          source: 'api',
          endpointPath,
          ...(status !== undefined ? { status } : {}),
          durationMs: Date.now() - startedAt,
          ...(responseBytes !== undefined ? { responseBytes } : {}),
          ...(safeError.errorCode
            ? { errorCode: safeError.errorCode }
            : { errorCode: normalized.category }),
        }),
        'Moodle API request failed'
      );
      throw normalized;
    }
  }
}
