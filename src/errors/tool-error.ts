import type { MachineCode } from './codes';

export type AuthRetryHint = {
  afterAuth: boolean;
  authUrl?: string;
};

/**
 * Build a JSON-serializable auth-required payload (eClass-style tools).
 * Prefer this over ad-hoc objects so `code` stays consistent (E12).
 */
export function sessionExpiredPayload(
  message: string,
  retry: AuthRetryHint
): {
  status: 'auth_required';
  message: string;
  code: 'SESSION_EXPIRED';
  retry: AuthRetryHint;
} {
  return {
    status: 'auth_required',
    message,
    code: 'SESSION_EXPIRED',
    retry,
  };
}

export type ToolErrorPayload = {
  status: 'error' | 'auth_required';
  message: string;
  code: MachineCode;
  retry?: AuthRetryHint;
  details?: Record<string, unknown>;
};

/**
 * Generic structured error for tool JSON bodies (non-auth failures).
 */
export function toErrorPayload(
  code: MachineCode,
  message: string,
  options?: {
    status?: 'error' | 'auth_required';
    retry?: AuthRetryHint;
    details?: Record<string, unknown>;
  }
): ToolErrorPayload {
  const status = options?.status ?? 'error';
  return {
    status,
    message,
    code,
    ...(options?.retry ? { retry: options.retry } : {}),
    ...(options?.details ? { details: options.details } : {}),
  };
}
