import fs from 'fs';
import os from 'os';
import path from 'path';

export const CLAUDE_CONFIG_BASENAME = 'claude_desktop_config.json';
const BACKUP_TIMESTAMP_PATTERN = /\d{8}-\d{6}/;

export class ClaudeConfigError extends Error {
  constructor(message, code = 'CLAUDE_CONFIG_ERROR') {
    super(message);
    this.name = 'ClaudeConfigError';
    this.code = code;
  }
}

export function getClaudeConfigCandidates(
  env = process.env,
  homeDir = os.homedir()
) {
  if (env.ECLASS_MCP_CLAUDE_CONFIG_PATH) {
    return [
      {
        id: 'override',
        path: env.ECLASS_MCP_CLAUDE_CONFIG_PATH,
      },
    ];
  }

  const storePath = path.join(
    homeDir,
    'AppData',
    'Local',
    'Packages',
    'Claude_pzs8sxrjxfjjc',
    'LocalCache',
    'Roaming',
    'Claude',
    'claude_desktop_config.json'
  );

  const standardWindowsPath = path.join(
    env.APPDATA || '',
    'Claude',
    'claude_desktop_config.json'
  );

  const macPath = path.join(
    homeDir,
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json'
  );

  const linuxPath = path.join(
    env.XDG_CONFIG_HOME || path.join(homeDir, '.config'),
    'Claude',
    'claude_desktop_config.json'
  );

  return [
    { id: 'windows_store', path: storePath },
    { id: 'windows_standard', path: standardWindowsPath },
    { id: 'macos', path: macPath },
    { id: 'linux', path: linuxPath },
  ];
}

export function resolveClaudeConfigPath(options = {}) {
  const fsImpl = options.fs || fs;
  const candidates =
    options.candidates ||
    getClaudeConfigCandidates(
      options.env || process.env,
      options.homeDir || os.homedir()
    );

  for (const candidate of candidates) {
    const dir = path.dirname(candidate.path);
    if (fsImpl.existsSync(candidate.path) || fsImpl.existsSync(dir)) {
      return candidate;
    }
  }

  return (
    candidates.find((candidate) => candidate.id === 'windows_standard') ||
    candidates[0]
  );
}

export function normalizePathForComparison(value) {
  if (!value || typeof value !== 'string') return '';
  return path.resolve(value).toLowerCase();
}

export function findExistingClaudeConfig(options = {}) {
  const fsImpl = options.fs || fs;
  const candidates =
    options.candidates ||
    getClaudeConfigCandidates(
      options.env || process.env,
      options.homeDir || os.homedir()
    );

  return (
    candidates.find((candidate) => fsImpl.existsSync(candidate.path)) || null
  );
}

export function buildEclassServerConfig(options = {}) {
  return {
    command: options.nodePath || process.execPath,
    args: [options.distPath],
  };
}

export function parseClaudeConfigText(raw, source = 'Claude config') {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { mcpServers: {} };
  }

  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ClaudeConfigError(
        `${source} must be a JSON object.`,
        'INVALID_CONFIG_SHAPE'
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof ClaudeConfigError) {
      throw error;
    }
    throw new ClaudeConfigError(
      `${source} is malformed JSON: ${error.message}`,
      'MALFORMED_JSON'
    );
  }
}

export function mergeClaudeConfig(existingConfig, serverConfig) {
  const config =
    existingConfig && typeof existingConfig === 'object'
      ? { ...existingConfig }
      : {};

  if (Array.isArray(config)) {
    throw new ClaudeConfigError(
      'Claude config must be a JSON object.',
      'INVALID_CONFIG_SHAPE'
    );
  }

  const existingServers = config.mcpServers;
  if (existingServers === undefined) {
    config.mcpServers = {};
  } else if (
    !existingServers ||
    typeof existingServers !== 'object' ||
    Array.isArray(existingServers)
  ) {
    throw new ClaudeConfigError(
      'Claude config mcpServers must be an object. Refusing to overwrite unknown data.',
      'INVALID_MCP_SERVERS'
    );
  } else {
    config.mcpServers = { ...existingServers };
  }

  config.mcpServers.eclass = { ...serverConfig };
  return config;
}

export function formatClaudeConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function summarizeEclassServer(config) {
  const server = config?.mcpServers?.eclass;
  if (!server) return 'not registered';
  const command =
    typeof server.command === 'string' && server.command.length > 0
      ? server.command
      : '<missing command>';
  const args = Array.isArray(server.args) ? server.args.join(' ') : '<no args>';
  return `${command} ${args}`.trim();
}

export function createConfigDiff(currentText, proposedText, options = {}) {
  const maxLines = options.maxLines || 220;
  if (currentText === proposedText) {
    return 'No changes.\n';
  }

  const currentLines = currentText.split(/\r?\n/);
  const proposedLines = proposedText.split(/\r?\n/);
  const out = ['--- current', '+++ proposed'];
  const max = Math.max(currentLines.length, proposedLines.length);

  for (let i = 0; i < max; i += 1) {
    if (out.length >= maxLines) {
      out.push(`... diff truncated after ${maxLines} lines`);
      break;
    }

    const before = currentLines[i];
    const after = proposedLines[i];
    if (before === after) {
      if (before !== undefined) out.push(`  ${before}`);
      continue;
    }
    if (before !== undefined) out.push(`- ${before}`);
    if (after !== undefined) out.push(`+ ${after}`);
  }

  return `${out.join('\n')}\n`;
}

export function formatBackupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function getBackupPath(configPath, date = new Date()) {
  return `${configPath}.${formatBackupTimestamp(date)}.bak`;
}

export function isClaudeConfigBackupName(
  fileName,
  configBaseName = CLAUDE_CONFIG_BASENAME
) {
  return new RegExp(
    `^${escapeRegExp(configBaseName)}\\.${BACKUP_TIMESTAMP_PATTERN.source}\\.bak$`
  ).test(fileName);
}

export function listClaudeConfigBackups(configPath, options = {}) {
  const fsImpl = options.fs || fs;
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  if (!fsImpl.existsSync(dir)) return [];

  return fsImpl
    .readdirSync(dir)
    .filter((fileName) => isClaudeConfigBackupName(fileName, base))
    .map((fileName) => path.join(dir, fileName))
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
}

export function validateBackupPath(configPath, backupPath) {
  const configDir = path.resolve(path.dirname(configPath));
  const resolvedBackup = path.resolve(backupPath);
  const backupDir = path.dirname(resolvedBackup);
  const expectedBase = path.basename(configPath);

  if (
    normalizePathForComparison(backupDir) !==
    normalizePathForComparison(configDir)
  ) {
    throw new ClaudeConfigError(
      'Backup path must be beside the selected Claude config.',
      'INVALID_BACKUP_PATH'
    );
  }

  if (!isClaudeConfigBackupName(path.basename(resolvedBackup), expectedBase)) {
    throw new ClaudeConfigError(
      `Backup file must match ${expectedBase}.YYYYMMDD-HHMMSS.bak.`,
      'INVALID_BACKUP_NAME'
    );
  }

  return resolvedBackup;
}

export function resolveRestoreBackup(configPath, value, options = {}) {
  if (!value) {
    throw new ClaudeConfigError(
      'Restore requires "latest" or a backup path.',
      'MISSING_RESTORE_TARGET'
    );
  }

  if (value === 'latest') {
    const backups = listClaudeConfigBackups(configPath, options);
    if (backups.length === 0) {
      throw new ClaudeConfigError(
        'No Claude config backups were found.',
        'NO_BACKUPS'
      );
    }
    return backups[0];
  }

  return validateBackupPath(configPath, value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
