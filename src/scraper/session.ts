import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

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
    fs.writeFileSync(
      getSessionFilePath(fileName),
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  } catch (error) {
    console.error('Error saving session:', error);
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
    const content = fs.readFileSync(file, 'utf-8');
    const data: SessionData = JSON.parse(content);

    if (!_isSessionFresh(data)) {
      return null;
    }

    return data.cookies;
  } catch (error) {
    console.error('Error loading session:', error);
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
    const content = fs.readFileSync(file, 'utf-8');
    const data: SessionData = JSON.parse(content);
    return _isSessionFresh(data);
  } catch (_error) {
    return false;
  }
}

export function clearSession(fileName: string = 'session.json'): void {
  const file = getSessionFilePath(fileName);
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  }
}
