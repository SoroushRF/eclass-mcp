import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const SESSION_FILE = path.resolve(__dirname, '../../.eclass-mcp/session.json');
const SESSION_STALE_HOURS = 60;

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
  const savedAt = new Date(data.saved_at);
  const now = new Date();
  const diffHours = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60);

  return diffHours < SESSION_STALE_HOURS;
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
