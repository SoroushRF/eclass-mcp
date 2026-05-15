import crypto from 'crypto';
import type { MachineCode } from '../errors/codes';
import {
  SecureSessionStorageError,
  assertSecureSessionConfigured,
  getSecureSessionSecret,
} from '../security/secure-session-store';

export const WRITE_PREFLIGHT_REF_FORMAT = 'eclass-mcp.preflight-ref.v1';
export const DEFAULT_PREFLIGHT_REF_TTL_MS = 15 * 60 * 1000;
export const ASSIGNMENT_SUBMISSION_PREFLIGHT_TOOL =
  'prepare_assignment_submission';

export interface WritePreflightRefPayload {
  format: typeof WRITE_PREFLIGHT_REF_FORMAT;
  tool: string;
  createdAt: string;
  expiresAt: string;
  targetHash: string;
  nonce: string;
}

export interface CreatePreflightRefOptions {
  tool?: string;
  targetFacts?: unknown;
  targetHash?: string;
  ttlMs?: number;
  now?: Date;
  nonce?: string;
}

export interface VerifyPreflightRefOptions {
  expectedTool?: string;
  now?: Date;
}

export class WritePreflightRefError extends Error {
  readonly code: MachineCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: MachineCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WritePreflightRefError';
    this.code = code;
    this.details = details;
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (cause) {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_REQUIRED',
      'Preflight reference is malformed.',
      { cause: cause instanceof Error ? cause.message : String(cause) }
    );
  }
}

function signingSecret(): string {
  assertSecureSessionConfigured();
  const secret = getSecureSessionSecret();
  if (!secret) {
    throw new SecureSessionStorageError(
      'missing_secret',
      'Secure session storage is not configured. Set ECLASS_MCP_SESSION_SECRET before using write preflight references.'
    );
  }
  return secret;
}

function signPayload(payloadBase64: string): string {
  return crypto
    .createHmac('sha256', signingSecret())
    .update(payloadBase64)
    .digest('base64url');
}

function stableNormalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .map((item) => stableNormalize(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = stableNormalize((value as Record<string, unknown>)[key]);
      if (child !== undefined) normalized[key] = child;
    }
    return normalized;
  }
  return value;
}

export function canonicalizePreflightTargetFacts(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

export function computePreflightTargetHash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(canonicalizePreflightTargetFacts(value))
    .digest('hex');
}

function assertPayload(value: unknown): WritePreflightRefPayload {
  if (!value || typeof value !== 'object') {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_REQUIRED',
      'Preflight reference payload is malformed.'
    );
  }
  const payload = value as Partial<WritePreflightRefPayload>;
  if (
    payload.format !== WRITE_PREFLIGHT_REF_FORMAT ||
    typeof payload.tool !== 'string' ||
    typeof payload.createdAt !== 'string' ||
    typeof payload.expiresAt !== 'string' ||
    typeof payload.targetHash !== 'string' ||
    typeof payload.nonce !== 'string'
  ) {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_REQUIRED',
      'Preflight reference payload is unsupported or incomplete.'
    );
  }
  return payload as WritePreflightRefPayload;
}

export function createPreflightRef(options: CreatePreflightRefOptions): {
  ref: string;
  payload: WritePreflightRefPayload;
} {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_PREFLIGHT_REF_TTL_MS;
  const targetHash =
    options.targetHash ??
    (options.targetFacts !== undefined
      ? computePreflightTargetHash(options.targetFacts)
      : undefined);

  if (!targetHash) {
    throw new WritePreflightRefError(
      'WRITE_PRECHECK_FAILED',
      'Cannot create preflight reference without target facts or target hash.'
    );
  }

  const payload: WritePreflightRefPayload = {
    format: WRITE_PREFLIGHT_REF_FORMAT,
    tool: options.tool ?? ASSIGNMENT_SUBMISSION_PREFLIGHT_TOOL,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    targetHash,
    nonce: options.nonce ?? crypto.randomBytes(16).toString('base64url'),
  };
  const payloadBase64 = base64UrlJson(payload);
  const signature = signPayload(payloadBase64);
  return {
    ref: `preflight.${payloadBase64}.${signature}`,
    payload,
  };
}

export function verifyPreflightRef(
  ref: string,
  options: VerifyPreflightRefOptions = {}
): WritePreflightRefPayload {
  const parts = ref.split('.');
  if (parts.length !== 3 || parts[0] !== 'preflight') {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_REQUIRED',
      'Preflight reference is missing or malformed.'
    );
  }

  const [, payloadBase64, signature] = parts;
  const expectedSignature = signPayload(payloadBase64);
  const provided = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(expectedSignature, 'base64url');
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_REQUIRED',
      'Preflight reference signature is invalid.'
    );
  }

  const payload = assertPayload(parseBase64UrlJson(payloadBase64));
  const expectedTool =
    options.expectedTool ?? ASSIGNMENT_SUBMISSION_PREFLIGHT_TOOL;
  if (payload.tool !== expectedTool) {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_REQUIRED',
      'Preflight reference was created for a different tool.',
      { expectedTool, actualTool: payload.tool }
    );
  }

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_REQUIRED',
      'Preflight reference expiry is malformed.'
    );
  }

  const now = options.now ?? new Date();
  if (expiresAt <= now.getTime()) {
    throw new WritePreflightRefError(
      'WRITE_PREFLIGHT_EXPIRED',
      'Preflight reference has expired. Call the prepare tool again.',
      { expiresAt: payload.expiresAt }
    );
  }

  return payload;
}
