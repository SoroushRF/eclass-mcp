import fs from 'fs';
import path from 'path';
import { getSessionFilePath } from '../scraper/session';
import {
  CENGAGE_SESSION_META_PATH,
  CENGAGE_STATE_PATH,
} from '../scraper/cengage-session';
import { clearActiveEclassAccountScope, getActiveEclassAccountScope } from '../cache/account-scope';
import { cache } from '../cache/store';
import { secureDeleteFile } from './secure-session-store';

export interface ClearAuthSessionsResult {
  removed: string[];
  missing: string[];
  errors: Array<{ path: string; message: string }>;
}

function knownAuthSessionPaths(): string[] {
  const basePaths = [
    getSessionFilePath(),
    CENGAGE_STATE_PATH,
    CENGAGE_SESSION_META_PATH,
  ];

  const dirs = new Set(basePaths.map((filePath) => path.dirname(filePath)));
  const tmpPaths: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      if (
        name.startsWith('session.json.tmp-') ||
        name.startsWith('cengage-state.json.tmp-') ||
        name.startsWith('cengage-session-meta.json.tmp-')
      ) {
        tmpPaths.push(fullPath);
      }
    }
  }

  return [...basePaths, ...tmpPaths];
}

export function clearAllAuthSessions(): ClearAuthSessionsResult {
  const activeAccountScope = getActiveEclassAccountScope();
  const result: ClearAuthSessionsResult = {
    removed: [],
    missing: [],
    errors: [],
  };

  for (const filePath of knownAuthSessionPaths()) {
    if (!fs.existsSync(filePath)) {
      result.missing.push(filePath);
      continue;
    }

    try {
      const removed = secureDeleteFile(filePath);
      if (removed) {
        result.removed.push(filePath);
      } else {
        result.missing.push(filePath);
      }
    } catch (error) {
      result.errors.push({
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (activeAccountScope) {
    cache.clearEclassAccountScope(activeAccountScope);
  }
  clearActiveEclassAccountScope();

  return result;
}
