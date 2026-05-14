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
    message: string = 'eClass session expired or invalid. Please re-authenticate at http://localhost:3000/auth'
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

interface SessionData {
  saved_at: string;
  cookies: Cookie[];
}

export function saveSession(
  cookies: Cookie[],
  fileName: string = 'session.json'
): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const data: SessionData = {
    saved_at: new Date().toISOString(),
    cookies: cookies,
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

function isSessionData(value: unknown): value is SessionData {
  const data = value as Partial<SessionData>;
  return (
    !!data &&
    typeof data === 'object' &&
    typeof data.saved_at === 'string' &&
    Array.isArray(data.cookies)
  );
}

function loadSessionData(file: string): SessionData {
  const data = readSecureJsonFile<SessionData>(file);
  if (!isSessionData(data)) {
    throw new SecureSessionStorageError(
      'malformed_envelope',
      'Secure session payload is malformed.',
      { filePath: file }
    );
  }
  return data;
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
  const file = getSessionFilePath(fileName);
  if (fs.existsSync(file)) {
    try {
      secureDeleteFile(file);
    } catch (error) {
      getLogger().error({ err: error }, 'Error clearing session');
    }
  }
}
