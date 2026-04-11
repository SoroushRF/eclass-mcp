import fs from 'fs';
import path from 'path';

export const CENGAGE_SESSION_DIR = path.resolve(
  __dirname,
  '../../.eclass-mcp'
);
export const CENGAGE_STATE_PATH = path.join(
  CENGAGE_SESSION_DIR,
  'cengage-state.json'
);
export const CENGAGE_SESSION_META_PATH = path.join(
  CENGAGE_SESSION_DIR,
  'cengage-session-meta.json'
);

/** Hours after which a saved Cengage session is treated as stale. */
export const CENGAGE_SESSION_STALE_HOURS = 60;

export interface CengageSessionMeta {
  saved_at: string;
  state_path: string;
}

export type CengageSessionValidityReason =
  | 'ok'
  | 'missing_state'
  | 'invalid_meta'
  | 'invalid_state'
  | 'stale';

export interface CengageSessionValidity {
  valid: boolean;
  reason: CengageSessionValidityReason;
  statePath: string;
  metaPath: string;
  savedAt?: string;
}

export interface CengageSessionValidityOptions {
  statePath?: string;
  metaPath?: string;
  now?: Date;
  staleHours?: number;
}

function getSessionPaths(options?: { statePath?: string; metaPath?: string }): {
  statePath: string;
  metaPath: string;
} {
  return {
    statePath: options?.statePath || CENGAGE_STATE_PATH,
    metaPath: options?.metaPath || CENGAGE_SESSION_META_PATH,
  };
}

export function ensureCengageSessionDir(
  statePath: string = CENGAGE_STATE_PATH
) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function saveCengageSessionMetadata(options?: {
  statePath?: string;
  metaPath?: string;
  savedAt?: Date;
}): void {
  const { statePath, metaPath } = getSessionPaths(options);
  ensureCengageSessionDir(statePath);

  const payload: CengageSessionMeta = {
    saved_at: (options?.savedAt || new Date()).toISOString(),
    state_path: statePath,
  };

  fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2), 'utf-8');
}

interface CengageSessionMetaLoadResult {
  meta: CengageSessionMeta | null;
  exists: boolean;
  invalid: boolean;
}

function loadCengageSessionMetadata(
  metaPath: string
): CengageSessionMetaLoadResult {
  if (!fs.existsSync(metaPath)) {
    return { meta: null, exists: false, invalid: false };
  }

  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(raw) as CengageSessionMeta;

    if (!parsed?.saved_at || typeof parsed.saved_at !== 'string') {
      return { meta: null, exists: true, invalid: true };
    }

    return { meta: parsed, exists: true, invalid: false };
  } catch {
    return { meta: null, exists: true, invalid: true };
  }
}

export function isSavedCengageSessionFresh(
  savedAtIso: string,
  now: Date,
  staleHours: number = CENGAGE_SESSION_STALE_HOURS
): boolean {
  const savedAt = new Date(savedAtIso);
  if (Number.isNaN(savedAt.getTime())) return false;

  const diffHours = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60);
  return diffHours < staleHours;
}

export function getCengageSessionValidity(
  options?: CengageSessionValidityOptions
): CengageSessionValidity {
  const { statePath, metaPath } = getSessionPaths(options);
  const now = options?.now || new Date();
  const staleHours = options?.staleHours ?? CENGAGE_SESSION_STALE_HOURS;

  if (!fs.existsSync(statePath)) {
    return {
      valid: false,
      reason: 'missing_state',
      statePath,
      metaPath,
    };
  }

  const metaLoad = loadCengageSessionMetadata(metaPath);
  if (metaLoad.invalid) {
    return {
      valid: false,
      reason: 'invalid_meta',
      statePath,
      metaPath,
    };
  }

  let savedAt = metaLoad.meta?.saved_at;

  if (!savedAt) {
    try {
      const stat = fs.statSync(statePath);
      savedAt = stat.mtime.toISOString();
      saveCengageSessionMetadata({
        statePath,
        metaPath,
        savedAt: new Date(savedAt),
      });
    } catch {
      return {
        valid: false,
        reason: 'invalid_state',
        statePath,
        metaPath,
      };
    }

    const fresh = isSavedCengageSessionFresh(savedAt, now, staleHours);
    return {
      valid: fresh,
      reason: fresh ? 'ok' : 'stale',
      statePath,
      metaPath,
      savedAt,
    };
  }

  if (!isSavedCengageSessionFresh(savedAt, now, staleHours)) {
    return {
      valid: false,
      reason: 'stale',
      statePath,
      metaPath,
      savedAt,
    };
  }

  return {
    valid: true,
    reason: 'ok',
    statePath,
    metaPath,
    savedAt,
  };
}
