import { redactStructuredLogFields } from './redact';

export interface SafeApiLogFields {
  operation: string;
  source?: string;
  endpointPath: string;
  status?: number;
  durationMs: number;
  responseBytes?: number;
  errorCode?: string;
  tokenPresent?: boolean;
  fallback?: boolean;
  fallbackReason?: string;
}

export interface SafeApiErrorLog {
  errorType: string;
  errorCode?: string;
}

function safeOperation(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100) || 'unknown';
}

function safeEndpointPath(value: string): string {
  try {
    const parsed = new URL(value, 'https://eclass.invalid');
    return parsed.pathname.startsWith('/')
      ? parsed.pathname.slice(0, 200)
      : '/unknown';
  } catch {
    return '/unknown';
  }
}

function safeErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return code || undefined;
}

/** Builds the allowlisted fields permitted for authenticated API telemetry. */
export function createSafeApiLogFields(
  fields: Omit<SafeApiLogFields, 'operation' | 'endpointPath'> & {
    operation: string;
    endpointPath: string;
  }
): SafeApiLogFields {
  return redactStructuredLogFields({
    operation: safeOperation(fields.operation),
    ...(fields.source ? { source: safeOperation(fields.source) } : {}),
    endpointPath: safeEndpointPath(fields.endpointPath),
    ...(typeof fields.status === 'number' ? { status: fields.status } : {}),
    durationMs: Math.max(0, Math.round(fields.durationMs)),
    ...(typeof fields.responseBytes === 'number'
      ? { responseBytes: Math.max(0, Math.round(fields.responseBytes)) }
      : {}),
    ...(fields.errorCode ? { errorCode: safeErrorCode(fields.errorCode) } : {}),
    ...(fields.tokenPresent !== undefined
      ? { tokenPresent: fields.tokenPresent }
      : {}),
    ...(fields.fallback !== undefined ? { fallback: fields.fallback } : {}),
    ...(fields.fallbackReason
      ? { fallbackReason: safeOperation(fields.fallbackReason) }
      : {}),
  }) as unknown as SafeApiLogFields;
}

/** Converts an upstream error to a bounded, body/header-free log object. */
export function serializeApiErrorForLog(error: unknown): SafeApiErrorLog {
  if (!error || typeof error !== 'object') {
    return { errorType: 'UnknownError' };
  }

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    category?: unknown;
  };
  return {
    errorType:
      typeof candidate.name === 'string'
        ? safeOperation(candidate.name)
        : 'Error',
    ...(safeErrorCode(candidate.code ?? candidate.category)
      ? {
          errorCode: safeErrorCode(candidate.code ?? candidate.category),
        }
      : {}),
  };
}

/** Safe serializer for generic runtime errors that may wrap upstream details. */
export function serializeErrorForLog(error: unknown): SafeApiErrorLog {
  return serializeApiErrorForLog(error);
}
