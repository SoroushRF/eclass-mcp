import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getLogger } from '../logging/context';
import {
  SecureSessionStorageError,
  readSecureJsonFile,
  secureDeleteFile,
  writeSecureJsonFile,
} from '../security/secure-session-store';

export class SessionExpiredError extends Error {
  /** E12 machine code for session expiry (eClass / SIS paths). */
  readonly code = 'SESSION_EXPIRED' as const;

  constructor(
    message: string = 'eClass session expired or invalid. Please re-authenticate at http://127.0.0.1:3000/auth'
  ) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

dotenv.config({ quiet: true });

const SESSION_DIR = path.resolve(__dirname, '../../.eclass-mcp');

export function getSessionFilePath(fileName: string = 'session.json') {
  return path.resolve(SESSION_DIR, fileName);
}

/** Hours after which a saved session is treated as stale (exported for tests). */
export const SESSION_STALE_HOURS = 60;

/**
 * Pure staleness check for a session `saved_at` ISO timestamp.
 */
export function isSavedSessionFresh(
  savedAtIso: string,
  now: Date,
  staleHours: number = SESSION_STALE_HOURS
): boolean {
  const savedAt = new Date(savedAtIso);
  const diffHours = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60);
  return diffHours < staleHours;
}

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export const LEGACY_SESSION_DATA_SCHEMA_VERSION = 1 as const;
export const SESSION_DATA_SCHEMA_VERSION = 2 as const;

export interface MobileCredential {
  service: 'moodle_mobile_app';
  token: string;
  /** Only issued on fresh logins over HTTPS; enables autologin keys. */
  privateToken?: string;
  issuedAt: string;
  expiresAt?: string;
}

export interface SessionData {
  schema_version: typeof SESSION_DATA_SCHEMA_VERSION;
  saved_at: string;
  cookies: Cookie[];
  mobile?: MobileCredential;
}

/**
 * In-process counter that changes on every login, logout and session clear.
 * A token renewal captures it when it starts and refuses to save if it moved,
 * so a renewal still in flight cannot restore a credential after logout or
 * write one into another account's session.
 */
let authGeneration = 0;

export function getAuthGeneration(): number {
  return authGeneration;
}

export function advanceAuthGeneration(): number {
  authGeneration += 1;
  return authGeneration;
}

export class AuthGenerationChangedError extends Error {
  constructor() {
    super('The eClass session changed while a mobile token was being renewed.');
    this.name = 'AuthGenerationChangedError';
  }
}

export function saveSession(
  cookies: Cookie[],
  fileName: string = 'session.json',
  mobile?: MobileCredential
): void {
  advanceAuthGeneration();
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const data: SessionData = {
    schema_version: SESSION_DATA_SCHEMA_VERSION,
    saved_at: new Date().toISOString(),
    cookies: cookies,
    ...(mobile ? { mobile } : {}),
  };

  try {
    writeSecureJsonFile(getSessionFilePath(fileName), data);
  } catch (error) {
    if (error instanceof SecureSessionStorageError) {
      throw error;
    }
    getLogger().error({ err: error }, 'Error saving session');
  }
}

interface LegacySessionData {
  schema_version?: unknown;
  saved_at: string;
  cookies: unknown;
  mobile?: unknown;
}

function isMobileCredential(value: unknown): value is MobileCredential {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MobileCredential>;
  return (
    candidate.service === 'moodle_mobile_app' &&
    typeof candidate.token === 'string' &&
    candidate.token.trim().length > 0 &&
    (candidate.privateToken === undefined ||
      (typeof candidate.privateToken === 'string' &&
        candidate.privateToken.trim().length > 0)) &&
    typeof candidate.issuedAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.issuedAt)) &&
    (candidate.expiresAt === undefined ||
      (typeof candidate.expiresAt === 'string' &&
        !Number.isNaN(Date.parse(candidate.expiresAt))))
  );
}

function isSessionData(value: unknown): value is LegacySessionData {
  const data = value as Partial<LegacySessionData>;
  return (
    !!data &&
    typeof data === 'object' &&
    typeof data.saved_at === 'string' &&
    Array.isArray(data.cookies)
  );
}

function loadSessionData(file: string): SessionData {
  const data = readSecureJsonFile<LegacySessionData>(file);
  if (!isSessionData(data)) {
    throw new SecureSessionStorageError(
      'malformed_envelope',
      'Secure session payload is malformed.',
      { filePath: file }
    );
  }
  if (
    data.schema_version !== undefined &&
    data.schema_version !== LEGACY_SESSION_DATA_SCHEMA_VERSION &&
    data.schema_version !== SESSION_DATA_SCHEMA_VERSION
  ) {
    throw new SecureSessionStorageError(
      'unsupported_envelope',
      'Secure session payload uses an unsupported schema version.',
      { filePath: file }
    );
  }
  if (data.mobile !== undefined && !isMobileCredential(data.mobile)) {
    throw new SecureSessionStorageError(
      'malformed_envelope',
      'Secure session mobile credential is malformed.',
      { filePath: file }
    );
  }
  return {
    schema_version: SESSION_DATA_SCHEMA_VERSION,
    saved_at: data.saved_at,
    cookies: data.cookies as Cookie[],
    ...(data.mobile ? { mobile: data.mobile } : {}),
  };
}

export function saveMobileCredential(
  mobile: MobileCredential,
  fileName: string = 'session.json'
): void {
  if (!isMobileCredential(mobile)) {
    throw new SecureSessionStorageError(
      'malformed_envelope',
      'Mobile credential is malformed.'
    );
  }
  const file = getSessionFilePath(fileName);
  const data = loadSessionData(file);
  writeSecureJsonFile(file, {
    ...data,
    schema_version: SESSION_DATA_SCHEMA_VERSION,
    mobile,
  });
}

/**
 * Saves a renewed credential only if no login, logout or clear happened
 * since `generation` was captured.
 */
export function saveMobileCredentialForGeneration(
  mobile: MobileCredential,
  generation: number,
  fileName: string = 'session.json'
): void {
  if (generation !== authGeneration) {
    throw new AuthGenerationChangedError();
  }
  saveMobileCredential(mobile, fileName);
}

export function clearMobileCredential(fileName: string = 'session.json'): void {
  const file = getSessionFilePath(fileName);
  if (!fs.existsSync(file)) return;
  const data = loadSessionData(file);
  const { mobile: _mobile, ...withoutMobile } = data;
  writeSecureJsonFile(file, {
    ...withoutMobile,
    schema_version: SESSION_DATA_SCHEMA_VERSION,
  });
}

export function loadMobileCredential(
  fileName: string = 'session.json'
): MobileCredential | null {
  const file = getSessionFilePath(fileName);
  if (!fs.existsSync(file)) return null;
  const data = loadSessionData(file);
  if (!data.mobile) return null;
  if (
    data.mobile.expiresAt &&
    new Date(data.mobile.expiresAt).getTime() <= Date.now()
  ) {
    return null;
  }
  return data.mobile;
}

export function hasMobileCredential(
  fileName: string = 'session.json'
): boolean {
  return loadMobileCredential(fileName) !== null;
}

export function loadSessionDataForTests(
  fileName: string = 'session.json'
): SessionData | null {
  const file = getSessionFilePath(fileName);
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    return loadSessionData(file);
  } catch (error) {
    if (error instanceof SecureSessionStorageError) {
      throw error;
    }
    getLogger().error({ err: error }, 'Error saving session');
    return null;
  }
}

export function loadSession(
  fileName: string = 'session.json'
): Cookie[] | null {
  const file = getSessionFilePath(fileName);
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    const data = loadSessionData(file);

    if (!_isSessionFresh(data)) {
      return null;
    }

    return data.cookies;
  } catch (error) {
    if (error instanceof SecureSessionStorageError) {
      throw error;
    }
    getLogger().error({ err: error }, 'Error loading session');
    return null;
  }
}

/**
 * Internal check for session staleness
 */
function _isSessionFresh(data: SessionData): boolean {
  return isSavedSessionFresh(data.saved_at, new Date());
}

/**
 * Exported check for session validity from disk
 */
export function isSessionValid(fileName: string = 'session.json'): boolean {
  const file = getSessionFilePath(fileName);
  if (!fs.existsSync(file)) {
    return false;
  }

  try {
    const data = loadSessionData(file);
    return _isSessionFresh(data);
  } catch (_error) {
    if (_error instanceof SecureSessionStorageError) {
      throw _error;
    }
    return false;
  }
}

export function clearSession(fileName: string = 'session.json'): void {
  advanceAuthGeneration();
  const file = getSessionFilePath(fileName);
  if (fs.existsSync(file)) {
    try {
      secureDeleteFile(file);
    } catch (error) {
      getLogger().error({ err: error }, 'Error clearing session');
    }
  }
}
