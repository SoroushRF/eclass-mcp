import childProcess from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import {
  normalizePathForComparison,
  resolveClaudeConfigPath,
} from './lib/claude-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist', 'index.js');
const SESSION_DIR = path.join(PROJECT_ROOT, '.eclass-mcp');
const SESSION_PATH = path.join(SESSION_DIR, 'session.json');
const CENGAGE_STATE_PATH = path.join(SESSION_DIR, 'cengage-state.json');
const CENGAGE_META_PATH = path.join(SESSION_DIR, 'cengage-session-meta.json');
const SECURE_SESSION_FORMAT = 'eclass-mcp.secure-session.v1';
const MIN_SECRET_LENGTH = 32;
const SESSION_STALE_HOURS = 60;
const require = createRequire(import.meta.url);

const STATUS_ORDER = ['PASS', 'WARN', 'FAIL', 'INFO', 'SKIP'];

function result(status, name, message, detail, fix) {
  return { status, name, message, detail, fix };
}

export function pass(name, message, detail) {
  return result('PASS', name, message, detail);
}

export function warn(name, message, detail, fix) {
  return result('WARN', name, message, detail, fix);
}

export function fail(name, message, detail, fix) {
  return result('FAIL', name, message, detail, fix);
}

export function info(name, message, detail) {
  return result('INFO', name, message, detail);
}

export function skip(name, message, detail) {
  return result('SKIP', name, message, detail);
}

export function isNodeVersionAtLeast(
  version,
  minMajor = 20,
  minMinor = 19,
  minPatch = 0
) {
  const [major, minor = 0, patch = 0] = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(major)) return false;
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

export function parseAuthPort(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { valid: true, port: 3000, defaulted: true };
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    return { valid: false, reason: 'not_an_integer' };
  }

  const port = Number.parseInt(normalized, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { valid: false, reason: 'out_of_range' };
  }

  return { valid: true, port, defaulted: false };
}

export function validateSessionSecret(secret) {
  if (!secret) {
    return { ok: false, reason: 'missing' };
  }

  if (String(secret).length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: 'weak' };
  }

  return { ok: true };
}

export function hasFail(results) {
  return results.some((entry) => entry.status === 'FAIL');
}

export function summarizeResults(results) {
  const summary = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  for (const entry of results) {
    summary[entry.status] = (summary[entry.status] || 0) + 1;
  }
  return summary;
}

export function safePath(filePath) {
  if (!filePath) return '';
  try {
    return path.resolve(filePath);
  } catch {
    return String(filePath);
  }
}

function conciseErrorMessage(error, maxLength = 240) {
  const message = (error?.message || String(error)).replace(
    /\x1B\[[0-?]*[ -/]*[@-~]/g,
    ''
  );
  const firstLine =
    message
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && line !== 'Call log:') || 'unknown error';
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength - 3)}...`
    : firstLine;
}

function execFileWithTimeout(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const child = childProcess.execFile(
        command,
        args,
        { timeout: timeoutMs, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, error, stdout, stderr });
            return;
          }

          resolve({ ok: true, stdout, stderr });
        }
      );

      child.on('error', (error) =>
        resolve({ ok: false, error, stdout: '', stderr: '' })
      );
    } catch (error) {
      resolve({ ok: false, error, stdout: '', stderr: '' });
    }
  });
}

function commandExists(command) {
  if (!command || typeof command !== 'string') return false;
  if (path.isAbsolute(command)) return fs.existsSync(command);

  const checker = process.platform === 'win32' ? 'where' : 'which';
  try {
    const found = childProcess.spawnSync(checker, [command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return found.status === 0;
  } catch {
    return false;
  }
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

async function checkPortAvailability(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      resolve({
        available: false,
        code: error?.code || 'unknown',
        message: error.message,
      });
    });
    server.once('listening', () => {
      server.close(() => resolve({ available: true }));
    });
    server.listen(port, '127.0.0.1');
  });
}

function decryptSecureEnvelope(filePath, secret) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let envelope;

  try {
    envelope = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }

  if (
    !envelope ||
    typeof envelope !== 'object' ||
    envelope.format !== SECURE_SESSION_FORMAT
  ) {
    return { ok: false, reason: 'legacy_plaintext' };
  }

  if (
    envelope.cipher !== 'aes-256-gcm' ||
    envelope.kdf !== 'scrypt' ||
    !envelope.kdf_params ||
    envelope.kdf_params.key_length !== 32 ||
    typeof envelope.kdf_params.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.payload !== 'string'
  ) {
    return { ok: false, reason: 'malformed_envelope' };
  }

  try {
    const salt = Buffer.from(envelope.kdf_params.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const payload = Buffer.from(envelope.payload, 'base64');
    const key = crypto.scryptSync(secret, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]);
    return { ok: true, data: JSON.parse(decrypted.toString('utf8')) };
  } catch {
    return { ok: false, reason: 'decrypt_failed' };
  }
}

export function classifySavedAt(savedAt, now = new Date()) {
  if (typeof savedAt !== 'string') {
    return { fresh: false, reason: 'missing_saved_at' };
  }

  const timestamp = Date.parse(savedAt);
  if (Number.isNaN(timestamp)) {
    return { fresh: false, reason: 'invalid_saved_at' };
  }

  const ageHours = (now.getTime() - timestamp) / (1000 * 60 * 60);
  if (ageHours < 0) {
    return { fresh: true, reason: 'future_timestamp', ageHours };
  }

  return {
    fresh: ageHours <= SESSION_STALE_HOURS,
    reason: ageHours <= SESSION_STALE_HOURS ? 'fresh' : 'stale',
    ageHours,
  };
}

export function inspectSecureSessionFile(filePath, secret, now = new Date()) {
  if (!fileExists(filePath)) {
    return { state: 'missing' };
  }

  const secretStatus = validateSessionSecret(secret);
  if (!secretStatus.ok) {
    return { state: 'storage_unavailable', reason: secretStatus.reason };
  }

  const decrypted = decryptSecureEnvelope(filePath, secret);
  if (!decrypted.ok) {
    return { state: 'storage_unavailable', reason: decrypted.reason };
  }

  const freshness = classifySavedAt(decrypted.data?.saved_at, now);
  if (!freshness.fresh) {
    return {
      state: 'stale',
      reason: freshness.reason,
      ageHours: freshness.ageHours,
    };
  }

  return { state: 'ok', ageHours: freshness.ageHours };
}

export function inspectCengageSessionFiles(
  statePath,
  metaPath,
  secret,
  now = new Date()
) {
  if (!fileExists(statePath)) {
    return { state: 'missing_state' };
  }

  const secureState = inspectSecureSessionFile(statePath, secret, now);
  if (secureState.state === 'storage_unavailable') {
    return { state: 'storage_unavailable', reason: secureState.reason };
  }
  if (secureState.state === 'stale') {
    return {
      state: 'stale',
      reason: secureState.reason,
      ageHours: secureState.ageHours,
    };
  }
  if (secureState.state !== 'ok') {
    return { state: 'invalid_state', reason: secureState.state };
  }

  if (fileExists(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (!meta || typeof meta !== 'object') {
        return { state: 'invalid_meta', reason: 'not_object' };
      }
      if (meta.saved_at) {
        const freshness = classifySavedAt(meta.saved_at, now);
        if (!freshness.fresh) {
          return {
            state: 'stale',
            reason: freshness.reason,
            ageHours: freshness.ageHours,
          };
        }
      }
    } catch {
      return { state: 'invalid_meta', reason: 'malformed_json' };
    }
  }

  return { state: 'ok', ageHours: secureState.ageHours };
}

export function validateClaudeConfig(config, options) {
  const projectDist = options.distPath || DIST_PATH;
  const commandAvailable = options.commandExists || commandExists;
  const server = config?.mcpServers?.eclass;

  if (!server) {
    return warn(
      'Claude eclass server',
      'not registered',
      undefined,
      'Run: npm run setup'
    );
  }

  if (!server.command || typeof server.command !== 'string') {
    return fail(
      'Claude eclass command',
      'missing command',
      undefined,
      'Run: npm run setup'
    );
  }

  if (!commandAvailable(server.command)) {
    return fail(
      'Claude eclass command',
      `not found: ${server.command}`,
      undefined,
      'Run: npm run setup'
    );
  }

  const args = Array.isArray(server.args) ? server.args : [];
  const target = args.find(
    (arg) =>
      typeof arg === 'string' && /(^|[\\/])dist[\\/]index\.js$/i.test(arg)
  );
  if (!target) {
    return warn(
      'Claude eclass target',
      'does not reference dist/index.js',
      undefined,
      'Run: npm run setup'
    );
  }

  const normalizedTarget = normalizePathForComparison(target);
  const normalizedExpected = normalizePathForComparison(projectDist);
  if (normalizedTarget === normalizedExpected) {
    return pass(
      'Claude eclass server',
      'points to this repo dist/index.js',
      safePath(target)
    );
  }

  if (fileExists(target)) {
    return warn(
      'Claude eclass target',
      'points to a different existing repo path',
      safePath(target),
      'Run: npm run setup from this repo if this is stale'
    );
  }

  return fail(
    'Claude eclass target',
    'points to a missing dist/index.js',
    safePath(target),
    'Run: npm run setup'
  );
}

function checkNodeVersion() {
  const version = process.versions.node;
  if (isNodeVersionAtLeast(version)) {
    return pass('Node.js >=20.19.0', `v${version}`);
  }
  return fail(
    'Node.js >=20.19.0',
    `found v${version}`,
    undefined,
    'Install Node.js 20.19.0 or newer'
  );
}

async function checkNpmAvailable() {
  if (process.env.npm_execpath && fileExists(process.env.npm_execpath)) {
    const npmViaNode = await execFileWithTimeout(
      process.execPath,
      [process.env.npm_execpath, '--version'],
      5000
    );
    if (npmViaNode.ok) {
      return pass('npm', String(npmViaNode.stdout).trim());
    }
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npm = await execFileWithTimeout(npmCommand, ['--version'], 5000);
  if (npm.ok) {
    return pass('npm', String(npm.stdout).trim());
  }
  return fail(
    'npm',
    'unavailable',
    conciseErrorMessage(npm.error),
    'Install npm with Node.js'
  );
}

function checkPackageJson() {
  const packagePath = path.join(PROJECT_ROOT, 'package.json');
  try {
    JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return pass('package.json', 'found and parseable', safePath(packagePath));
  } catch (error) {
    return fail('package.json', 'missing or malformed', error.message);
  }
}

function checkBuildArtifact() {
  const results = [];
  const sourcePath = path.join(PROJECT_ROOT, 'src', 'index.ts');
  results.push(
    fileExists(sourcePath)
      ? pass('src/index.ts', 'found', safePath(sourcePath))
      : fail('src/index.ts', 'missing', safePath(sourcePath))
  );
  results.push(
    fileExists(DIST_PATH)
      ? pass('dist/index.js', 'found', safePath(DIST_PATH))
      : fail(
          'dist/index.js',
          'missing',
          safePath(DIST_PATH),
          'Run: npm run build'
        )
  );
  return results;
}

function checkEnvFile(context) {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fileExists(envPath)) {
    return warn(
      '.env',
      'missing',
      safePath(envPath),
      'Create .env from .env.example'
    );
  }

  const parsed = dotenv.config({ path: envPath, quiet: true });
  if (parsed.error) {
    return fail('.env', 'could not be loaded', parsed.error.message);
  }

  Object.assign(context.env, parsed.parsed || {});
  return pass('.env', 'found', safePath(envPath));
}

function checkSessionSecret(context) {
  const secretStatus = validateSessionSecret(
    context.env.ECLASS_MCP_SESSION_SECRET
  );
  if (secretStatus.ok) {
    return pass('ECLASS_MCP_SESSION_SECRET', 'configured, length OK');
  }

  if (secretStatus.reason === 'weak') {
    return fail(
      'ECLASS_MCP_SESSION_SECRET',
      `too short; needs at least ${MIN_SECRET_LENGTH} characters`,
      undefined,
      'Set a long unique secret in .env'
    );
  }

  return fail(
    'ECLASS_MCP_SESSION_SECRET',
    'missing',
    undefined,
    'Set ECLASS_MCP_SESSION_SECRET in .env before authenticating'
  );
}

async function checkAuthPort(context) {
  const parsed = parseAuthPort(context.env.AUTH_PORT);
  if (!parsed.valid) {
    return fail(
      'AUTH_PORT',
      `invalid (${parsed.reason})`,
      undefined,
      'Use an integer from 1 to 65535'
    );
  }

  const availability = await checkPortAvailability(parsed.port);
  if (availability.available) {
    return pass(
      'AUTH_PORT',
      `${parsed.port}${parsed.defaulted ? ' (default)' : ''}`
    );
  }

  if (availability.code === 'EADDRINUSE') {
    return info(
      'AUTH_PORT',
      `${parsed.port} is already in use`,
      'An MCP/auth server may already be running'
    );
  }

  return warn(
    'AUTH_PORT',
    `${parsed.port} could not be probed`,
    availability.message
  );
}

async function checkPlaywrightChromium() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (error) {
    return fail(
      'Playwright',
      'package not importable',
      error.message,
      'Run: npm install'
    );
  }

  let browser;
  try {
    const launch = playwright.chromium.launch({ headless: true });
    browser = await Promise.race([
      launch,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chromium launch timed out')), 15000)
      ),
    ]);
    return pass('Playwright Chromium', 'launchable');
  } catch (error) {
    return fail(
      'Playwright Chromium',
      'not launchable',
      conciseErrorMessage(error),
      'Run: npx playwright install chromium'
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

function checkEclassSession(context) {
  const secretStatus = validateSessionSecret(
    context.env.ECLASS_MCP_SESSION_SECRET
  );
  if (!secretStatus.ok) {
    return skip(
      'eClass session',
      'not checked until ECLASS_MCP_SESSION_SECRET is configured'
    );
  }

  const state = inspectSecureSessionFile(
    SESSION_PATH,
    context.env.ECLASS_MCP_SESSION_SECRET
  );
  if (state.state === 'missing') {
    return warn(
      'eClass session',
      'missing',
      safePath(SESSION_PATH),
      `Start MCP, then visit http://localhost:${context.authPort}/auth`
    );
  }

  if (state.state === 'ok') {
    return pass('eClass session', 'encrypted and fresh');
  }

  if (state.state === 'stale') {
    return warn(
      'eClass session',
      `stale (${state.reason})`,
      safePath(SESSION_PATH),
      `Re-authenticate at http://localhost:${context.authPort}/auth`
    );
  }

  return warn(
    'eClass session',
    `storage unavailable (${state.reason})`,
    safePath(SESSION_PATH),
    'Set the correct secret, clear legacy sessions if needed, then authenticate again'
  );
}

function checkCengageSession(context) {
  const secretStatus = validateSessionSecret(
    context.env.ECLASS_MCP_SESSION_SECRET
  );
  if (!secretStatus.ok) {
    return skip(
      'Cengage session',
      'not checked until ECLASS_MCP_SESSION_SECRET is configured'
    );
  }

  const state = inspectCengageSessionFiles(
    CENGAGE_STATE_PATH,
    CENGAGE_META_PATH,
    context.env.ECLASS_MCP_SESSION_SECRET
  );

  if (state.state === 'ok') {
    return pass('Cengage session', 'encrypted and fresh');
  }

  const fix = `Start MCP, then visit http://localhost:${context.authPort}/auth-cengage`;
  if (state.state === 'missing_state') {
    return warn(
      'Cengage session',
      'missing_state',
      safePath(CENGAGE_STATE_PATH),
      fix
    );
  }

  if (state.state === 'storage_unavailable') {
    return warn(
      'Cengage session',
      `storage unavailable (${state.reason})`,
      safePath(CENGAGE_STATE_PATH),
      'Set the correct secret, clear legacy sessions if needed, then authenticate again'
    );
  }

  return warn('Cengage session', state.state, state.reason, fix);
}

function checkClaudeConfig() {
  const candidate = resolveClaudeConfigPath();
  const configDir = path.dirname(candidate.path);
  const results = [];

  try {
    fs.accessSync(configDir, fs.constants.R_OK | fs.constants.W_OK);
    results.push(
      pass('Claude config dir', 'readable and writable', safePath(configDir))
    );
  } catch (error) {
    if (fileExists(configDir)) {
      results.push(fail('Claude config dir', 'not accessible', error.message));
    } else {
      const parent = path.dirname(configDir);
      try {
        fs.accessSync(parent, fs.constants.W_OK);
        results.push(
          warn(
            'Claude config dir',
            'missing but parent writable',
            safePath(configDir),
            'Run: npm run setup'
          )
        );
      } catch (parentError) {
        results.push(
          fail(
            'Claude config dir',
            'missing and parent not writable',
            parentError.message
          )
        );
      }
    }
  }

  if (!fileExists(candidate.path)) {
    results.push(
      warn(
        'Claude config path',
        'config file missing',
        safePath(candidate.path),
        'Run: npm run setup'
      )
    );
    return results;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(candidate.path, 'utf8'));
  } catch (error) {
    results.push(
      fail(
        'Claude config JSON',
        'malformed',
        error.message,
        'Fix JSON or restore a backup before setup'
      )
    );
    return results;
  }

  results.push(
    pass('Claude config path', 'found and parseable', safePath(candidate.path))
  );
  results.push(validateClaudeConfig(config, { distPath: DIST_PATH }));
  return results;
}

function checkDirectoryAccess(label, dirPath) {
  if (fileExists(dirPath)) {
    try {
      fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
      return pass(label, 'readable and writable', safePath(dirPath));
    } catch (error) {
      return fail(label, 'not accessible', error.message);
    }
  }

  const parent = path.dirname(dirPath);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
    return warn(label, 'missing but parent writable', safePath(dirPath));
  } catch (error) {
    return fail(label, 'missing and parent not writable', error.message);
  }
}

function checkPermissions() {
  return [
    checkDirectoryAccess('project root permissions', PROJECT_ROOT),
    checkDirectoryAccess('.eclass-mcp permissions', SESSION_DIR),
    checkDirectoryAccess(
      '.eclass-mcp/cache permissions',
      path.join(SESSION_DIR, 'cache')
    ),
  ];
}

function checkParserDependencies() {
  const deps = ['pdfjs-dist', '@napi-rs/canvas', 'mammoth', 'adm-zip'];
  return deps.map((dep) => {
    try {
      require.resolve(dep);
      return pass(`dependency ${dep}`, 'resolvable');
    } catch (error) {
      return fail(
        `dependency ${dep}`,
        'missing',
        error.message,
        'Run: npm install'
      );
    }
  });
}

function collectAuthPort(context, results) {
  const parsed = parseAuthPort(context.env.AUTH_PORT);
  context.authPort = parsed.valid ? parsed.port : 3000;
  results.push(checkSessionSecret(context));
}

async function runDoctor() {
  const context = {
    env: { ...process.env },
    authPort: 3000,
  };
  const results = [];

  results.push(checkNodeVersion());
  results.push(await checkNpmAvailable());
  results.push(checkPackageJson());
  results.push(...checkBuildArtifact());
  results.push(checkEnvFile(context));
  collectAuthPort(context, results);
  results.push(await checkAuthPort(context));
  results.push(await checkPlaywrightChromium());
  results.push(checkEclassSession(context));
  results.push(checkCengageSession(context));
  results.push(...checkClaudeConfig());
  results.push(...checkPermissions());
  results.push(...checkParserDependencies());

  printHumanReport(results);
  return hasFail(results) ? 1 : 0;
}

export function printHumanReport(results) {
  console.log('eclass-mcp doctor');
  console.log('');

  for (const entry of results) {
    const status = entry.status.padEnd(4);
    const name = entry.name.padEnd(34);
    console.log(`${status} ${name} ${entry.message}`);
    if (entry.detail) {
      console.log(`     ${entry.detail}`);
    }
    if (entry.fix) {
      console.log(`     Fix: ${entry.fix}`);
    }
  }

  const counts = summarizeResults(results);
  console.log('');
  console.log(
    `Summary: ${counts.PASS} PASS, ${counts.WARN} WARN, ${counts.FAIL} FAIL, ${counts.INFO} INFO, ${counts.SKIP} SKIP`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runDoctor()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.log('eclass-mcp doctor');
      console.log('');
      console.log(`FAIL doctor                            ${error.message}`);
      process.exitCode = 1;
    });
}
