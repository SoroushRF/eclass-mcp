import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  ClaudeConfigError,
  buildEclassServerConfig,
  createConfigDiff,
  formatClaudeConfig,
  getBackupPath,
  listClaudeConfigBackups,
  mergeClaudeConfig,
  parseClaudeConfigText,
  resolveClaudeConfigPath,
  resolveRestoreBackup,
  summarizeEclassServer,
} from './lib/claude-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist', 'index.js');
const NODE_PATH = process.execPath;

const USAGE = `Usage:
  node scripts/setup.mjs
  node scripts/setup.mjs --dry-run
  node scripts/setup.mjs --list-backups
  node scripts/setup.mjs --restore latest
  node scripts/setup.mjs --restore <backupPath>
  node scripts/setup.mjs --help`;

function parseArgs(argv) {
  const result = {
    dryRun: false,
    listBackups: false,
    restore: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--list-backups') {
      result.listBackups = true;
    } else if (arg === '--restore') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new ClaudeConfigError(
          '--restore requires "latest" or a backup path.',
          'INVALID_ARGS'
        );
      }
      result.restore = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else {
      throw new ClaudeConfigError(
        `Unknown setup argument: ${arg}`,
        'INVALID_ARGS'
      );
    }
  }

  const modes = [
    result.dryRun,
    result.listBackups,
    result.restore !== undefined,
  ].filter(Boolean).length;
  if (modes > 1) {
    throw new ClaudeConfigError(
      '--dry-run, --list-backups, and --restore are mutually exclusive.',
      'INVALID_ARGS'
    );
  }

  return result;
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {
      config: { mcpServers: {} },
      text: formatClaudeConfig({ mcpServers: {} }),
    };
  }

  const text = fs.readFileSync(configPath, 'utf8');
  return {
    config: parseClaudeConfigText(text, configPath),
    text: text.trim() ? text : formatClaudeConfig({ mcpServers: {} }),
  };
}

function buildMergedConfig(configPath) {
  const current = readConfig(configPath);
  const server = buildEclassServerConfig({
    nodePath: NODE_PATH,
    distPath: DIST_PATH,
  });
  const proposed = mergeClaudeConfig(current.config, server);
  return {
    current: current.config,
    currentText: current.text,
    proposed,
    proposedText: formatClaudeConfig(proposed),
  };
}

function writeFileAtomic(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Best effort cleanup after a failed atomic write.
    }
    throw error;
  }
}

function createBackup(configPath) {
  if (!fs.existsSync(configPath)) return null;

  let backupPath = getBackupPath(configPath);
  for (let attempt = 1; fs.existsSync(backupPath); attempt += 1) {
    backupPath = getBackupPath(
      configPath,
      new Date(Date.now() + attempt * 1000)
    );
  }
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

function printDryRun(configPath) {
  const { current, currentText, proposed, proposedText } =
    buildMergedConfig(configPath);

  console.log('eclass-mcp setup dry run');
  console.log('');
  console.log(`Claude config: ${configPath}`);
  console.log(`Current eclass: ${summarizeEclassServer(current)}`);
  console.log(`Proposed eclass: ${summarizeEclassServer(proposed)}`);
  console.log('');
  console.log(createConfigDiff(currentText, proposedText).trimEnd());
}

function listBackups(configPath) {
  const backups = listClaudeConfigBackups(configPath);
  console.log('eclass-mcp setup backups');
  console.log('');
  console.log(`Claude config: ${configPath}`);

  if (backups.length === 0) {
    console.log('No backups found.');
    return;
  }

  for (const backup of backups) {
    console.log(backup);
  }
}

function runSetup(configPath) {
  console.error('Registering eClass MCP...');
  console.error(`Target config: ${configPath}`);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const { proposedText } = buildMergedConfig(configPath);
  const backupPath = createBackup(configPath);
  writeFileAtomic(configPath, proposedText);

  if (backupPath) {
    console.error(`Backup created: ${backupPath}`);
  }
  console.error('Successfully updated Claude config.');
  console.error(
    'Restart Claude Desktop now. Right-click tray icon > Quit, then relaunch.'
  );
}

function restoreBackup(configPath, restoreValue) {
  const backupPath = resolveRestoreBackup(configPath, restoreValue);
  if (!fs.existsSync(backupPath)) {
    throw new ClaudeConfigError(
      `Backup file does not exist: ${backupPath}`,
      'BACKUP_MISSING'
    );
  }

  const backupText = fs.readFileSync(backupPath, 'utf8');
  parseClaudeConfigText(backupText, backupPath);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const preRestoreBackup = createBackup(configPath);
  writeFileAtomic(
    configPath,
    backupText.trim() ? backupText : formatClaudeConfig({ mcpServers: {} })
  );

  console.error(`Restored Claude config from: ${backupPath}`);
  if (preRestoreBackup) {
    console.error(`Previous config backed up as: ${preRestoreBackup}`);
  }
}

export {
  buildMergedConfig,
  createBackup,
  listBackups,
  parseArgs,
  printDryRun,
  restoreBackup,
  runSetup,
  writeFileAtomic,
};

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const configPath = resolveClaudeConfigPath().path;
  if (args.dryRun) {
    printDryRun(configPath);
    return 0;
  }
  if (args.listBackups) {
    listBackups(configPath);
    return 0;
  }
  if (args.restore !== undefined) {
    restoreBackup(configPath, args.restore);
    return 0;
  }

  runSetup(configPath);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Setup failed: ${message}`);
      if (error?.code === 'MALFORMED_JSON') {
        console.error('Fix the JSON or run: npm run setup -- --restore latest');
      }
      console.error('');
      console.error(USAGE);
      process.exitCode = 1;
    });
}
