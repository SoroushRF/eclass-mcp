import crypto from 'crypto';
import {
  assertSecureSessionConfigured,
  getSecureSessionSecret,
} from '../security/secure-session-store';
import { getCacheKey } from './store';

export class EclassAccountScopeUnavailableError extends Error {
  readonly code = 'ACCOUNT_SCOPE_UNAVAILABLE' as const;

  constructor() {
    super(
      'Authenticated eClass cache scope is unavailable. Re-authenticate before reading cached eClass data.'
    );
    this.name = 'EclassAccountScopeUnavailableError';
  }
}

let activeAccountScope: string | null = null;

function normalizeOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new EclassAccountScopeUnavailableError();
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new EclassAccountScopeUnavailableError();
  }
  return parsed.origin;
}

function normalizeUserId(userId: string | number): string {
  const normalized = String(userId).trim();
  if (!normalized || !/^[0-9]+$/.test(normalized)) {
    throw new EclassAccountScopeUnavailableError();
  }
  return normalized;
}

export function deriveEclassAccountScope(
  origin: string,
  userId: string | number
): string {
  try {
    assertSecureSessionConfigured();
    const secret = getSecureSessionSecret();
    if (!secret) throw new Error('missing secret');

    const identity = `${normalizeOrigin(origin)}\u0000${normalizeUserId(userId)}`;
    return `acct_${crypto
      .createHmac('sha256', secret)
      .update(`eclass-account-scope-v1\u0000${identity}`)
      .digest('hex')
      .slice(0, 32)}`;
  } catch {
    throw new EclassAccountScopeUnavailableError();
  }
}

export function setActiveEclassAccountScope(
  origin: string,
  userId: string | number
): string {
  const scope = deriveEclassAccountScope(origin, userId);
  activeAccountScope = scope;
  return scope;
}

export function getActiveEclassAccountScope(): string | null {
  return activeAccountScope;
}

export function requireActiveEclassAccountScope(): string {
  if (!activeAccountScope) {
    throw new EclassAccountScopeUnavailableError();
  }
  return activeAccountScope;
}

export function clearActiveEclassAccountScope(scope?: string): void {
  if (!scope || activeAccountScope === scope) {
    activeAccountScope = null;
  }
}

export function getEclassCacheKey(
  prefix: string,
  ...segments: string[]
): string {
  return getCacheKey(
    'eclass',
    requireActiveEclassAccountScope(),
    prefix,
    ...segments
  );
}

export function tryGetEclassCacheKey(
  prefix: string,
  ...segments: string[]
): string | null {
  try {
    return getEclassCacheKey(prefix, ...segments);
  } catch (error) {
    if (error instanceof EclassAccountScopeUnavailableError) return null;
    throw error;
  }
}
