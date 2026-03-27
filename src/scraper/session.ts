import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export class SessionExpiredError extends Error {
  constructor(message: string = 'eClass session expired or invalid. Please re-authenticate at http://localhost:3000/auth') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

dotenv.config({ quiet: true });

const SESSION_FILE = path.resolve(__dirname, '../../.eclass-mcp/session.json');

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

export function saveSession(cookies: Cookie[]): void {
  const sessionDir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const data: SessionData = {
    saved_at: new Date().toISOString(),
    cookies: cookies,
  };

  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving session:', error);
  }
}

export function loadSession(): Cookie[] | null {
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(SESSION_FILE, 'utf-8');
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
export function isSessionValid(): boolean {
  if (!fs.existsSync(SESSION_FILE)) {
    return false;
  }

  try {
    const content = fs.readFileSync(SESSION_FILE, 'utf-8');
    const data: SessionData = JSON.parse(content);
    return _isSessionFresh(data);
  } catch (_error) {
    return false;
  }
}

export function clearSession(): void {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      fs.unlinkSync(SESSION_FILE);
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  }
}
