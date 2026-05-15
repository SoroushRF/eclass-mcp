import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from 'vitest';

type DoctorStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'SKIP';

interface DoctorResult {
  status: DoctorStatus;
  name: string;
  message: string;
  detail?: string;
  fix?: string;
}

interface DoctorModule {
  classifySavedAt(
    savedAt: string | undefined,
    now?: Date
  ): { fresh: boolean; reason: string };
  hasFail(results: DoctorResult[]): boolean;
  inspectCengageSessionFiles(
    statePath: string,
    metaPath: string,
    secret: string,
    now?: Date
  ): { state: string; reason?: string };
  inspectSecureSessionFile(
    filePath: string,
    secret: string,
    now?: Date
  ): { state: string; reason?: string };
  isNodeVersionAtLeast(version: string, minMajor?: number): boolean;
  parseAuthPort(value: string | undefined): {
    valid: boolean;
    port?: number;
    reason?: string;
  };
  summarizeResults(results: DoctorResult[]): Record<DoctorStatus, number>;
  validateClaudeConfig(
    config: unknown,
    options: { distPath: string; commandExists: (command: string) => boolean }
  ): DoctorResult;
  validateSessionSecret(secret: string | undefined): {
    ok: boolean;
    reason?: string;
  };
}

interface ClaudeConfigModule {
  resolveClaudeConfigPath(options: {
    candidates: Array<{ id: string; path: string }>;
    fs: { existsSync: (target: string) => boolean };
  }): { id: string; path: string };
}

const tempDirs: string[] = [];

async function loadDoctor(): Promise<DoctorModule> {
  const url = pathToFileURL(
    path.join(__dirname, '..', 'scripts', 'doctor.mjs')
  ).href;
  return (await import(url)) as DoctorModule;
}

async function loadClaudeConfig(): Promise<ClaudeConfigModule> {
  const url = pathToFileURL(
    path.join(__dirname, '..', 'scripts', 'lib', 'claude-config.mjs')
  ).href;
  return (await import(url)) as ClaudeConfigModule;
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eclass-mcp-doctor-'));
  tempDirs.push(dir);
  return dir;
}

function writeSecureEnvelope(
  filePath: string,
  secret: string,
  payload: unknown
): void {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const envelope = {
    format: 'eclass-mcp.secure-session.v1',
    created_at: new Date().toISOString(),
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    kdf_params: {
      salt: salt.toString('base64'),
      key_length: 32,
    },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    payload: encrypted.toString('base64'),
  };
  fs.writeFileSync(filePath, JSON.stringify(envelope), 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('doctor pure checks', () => {
  it('checks the Node.js major version boundary', async () => {
    const doctor = await loadDoctor();

    expect(doctor.isNodeVersionAtLeast('18.0.0')).toBe(true);
    expect(doctor.isNodeVersionAtLeast('25.5.0')).toBe(true);
    expect(doctor.isNodeVersionAtLeast('17.9.9')).toBe(false);
  });

  it('parses AUTH_PORT with the same default and rejects invalid values', async () => {
    const doctor = await loadDoctor();

    expect(doctor.parseAuthPort(undefined)).toMatchObject({
      valid: true,
      port: 3000,
    });
    expect(doctor.parseAuthPort('3000')).toMatchObject({
      valid: true,
      port: 3000,
    });
    expect(doctor.parseAuthPort('abc')).toMatchObject({ valid: false });
    expect(doctor.parseAuthPort('0')).toMatchObject({ valid: false });
    expect(doctor.parseAuthPort('-1')).toMatchObject({ valid: false });
  });

  it('validates the secure session secret without exposing the value', async () => {
    const doctor = await loadDoctor();
    const secret = 'doctor-test-secret-that-is-long-enough';

    expect(doctor.validateSessionSecret(undefined)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(doctor.validateSessionSecret('short')).toEqual({
      ok: false,
      reason: 'weak',
    });
    const result = doctor.validateSessionSecret(secret);
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('summarizes results and exits nonzero when any FAIL is present', async () => {
    const doctor = await loadDoctor();
    const results: DoctorResult[] = [
      { status: 'PASS', name: 'a', message: 'ok' },
      { status: 'WARN', name: 'b', message: 'warn' },
      { status: 'FAIL', name: 'c', message: 'fail' },
    ];

    expect(doctor.summarizeResults(results)).toMatchObject({
      PASS: 1,
      WARN: 1,
      FAIL: 1,
    });
    expect(doctor.hasFail(results)).toBe(true);
    expect(doctor.hasFail(results.slice(0, 2))).toBe(false);
  });
});

describe('doctor Claude config checks', () => {
  it('resolves the first existing Claude config candidate', async () => {
    const { resolveClaudeConfigPath } = await loadClaudeConfig();
    const root = makeTempDir();
    const candidates = [
      {
        id: 'windows_store',
        path: path.join(root, 'store', 'claude_desktop_config.json'),
      },
      {
        id: 'windows_standard',
        path: path.join(root, 'standard', 'claude_desktop_config.json'),
      },
    ];
    const existing = new Set([path.dirname(candidates[0].path)]);

    const resolved = resolveClaudeConfigPath({
      candidates,
      fs: { existsSync: (target: string) => existing.has(target) },
    });

    expect(resolved.id).toBe('windows_store');
  });

  it('falls back to the standard Windows path when no candidate exists', async () => {
    const { resolveClaudeConfigPath } = await loadClaudeConfig();
    const root = makeTempDir();
    const candidates = [
      {
        id: 'windows_store',
        path: path.join(root, 'store', 'claude_desktop_config.json'),
      },
      {
        id: 'windows_standard',
        path: path.join(root, 'standard', 'claude_desktop_config.json'),
      },
    ];

    const resolved = resolveClaudeConfigPath({
      candidates,
      fs: { existsSync: () => false },
    });

    expect(resolved.id).toBe('windows_standard');
  });

  it('validates registered eclass server command and target', async () => {
    const doctor = await loadDoctor();
    const distPath = path.join(makeTempDir(), 'dist', 'index.js');
    fs.mkdirSync(path.dirname(distPath), { recursive: true });
    fs.writeFileSync(distPath, '', 'utf8');

    const valid = doctor.validateClaudeConfig(
      {
        mcpServers: { eclass: { command: process.execPath, args: [distPath] } },
      },
      { distPath, commandExists: () => true }
    );
    expect(valid.status).toBe('PASS');

    const missingServer = doctor.validateClaudeConfig(
      { mcpServers: {} },
      { distPath, commandExists: () => true }
    );
    expect(missingServer.status).toBe('WARN');

    const missingCommand = doctor.validateClaudeConfig(
      { mcpServers: { eclass: { command: 'missing-node', args: [distPath] } } },
      { distPath, commandExists: () => false }
    );
    expect(missingCommand.status).toBe('FAIL');
  });

  it('warns for stale existing Claude targets and fails missing targets', async () => {
    const doctor = await loadDoctor();
    const root = makeTempDir();
    const expectedDist = path.join(root, 'current', 'dist', 'index.js');
    const staleDist = path.join(root, 'old', 'dist', 'index.js');
    const missingDist = path.join(root, 'missing', 'dist', 'index.js');
    fs.mkdirSync(path.dirname(expectedDist), { recursive: true });
    fs.mkdirSync(path.dirname(staleDist), { recursive: true });
    fs.writeFileSync(expectedDist, '', 'utf8');
    fs.writeFileSync(staleDist, '', 'utf8');

    const stale = doctor.validateClaudeConfig(
      {
        mcpServers: {
          eclass: { command: process.execPath, args: [staleDist] },
        },
      },
      { distPath: expectedDist, commandExists: () => true }
    );
    expect(stale).toMatchObject({
      status: 'WARN',
      name: 'Claude eclass target',
    });

    const missing = doctor.validateClaudeConfig(
      {
        mcpServers: {
          eclass: { command: process.execPath, args: [missingDist] },
        },
      },
      { distPath: expectedDist, commandExists: () => true }
    );
    expect(missing).toMatchObject({
      status: 'FAIL',
      name: 'Claude eclass target',
    });
  });
});

describe('doctor session checks', () => {
  it('classifies missing, legacy, wrong-secret, valid, and stale eClass sessions', async () => {
    const doctor = await loadDoctor();
    const dir = makeTempDir();
    const sessionPath = path.join(dir, 'session.json');
    const secret = 'doctor-test-secret-that-is-long-enough';
    const now = new Date('2026-05-15T12:00:00.000Z');

    expect(
      doctor.inspectSecureSessionFile(sessionPath, secret, now)
    ).toMatchObject({
      state: 'missing',
    });

    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ saved_at: now.toISOString() }),
      'utf8'
    );
    expect(
      doctor.inspectSecureSessionFile(sessionPath, secret, now)
    ).toMatchObject({
      state: 'storage_unavailable',
      reason: 'legacy_plaintext',
    });

    fs.writeFileSync(
      sessionPath,
      JSON.stringify({
        format: 'eclass-mcp.secure-session.v1',
        cipher: 'aes-256-gcm',
      }),
      'utf8'
    );
    expect(
      doctor.inspectSecureSessionFile(sessionPath, secret, now)
    ).toMatchObject({
      state: 'storage_unavailable',
      reason: 'malformed_envelope',
    });

    writeSecureEnvelope(sessionPath, secret, {
      saved_at: '2026-05-15T11:00:00.000Z',
      cookies: [],
    });
    expect(
      doctor.inspectSecureSessionFile(
        sessionPath,
        'wrong-secret-but-long-enough-for-test',
        now
      )
    ).toMatchObject({
      state: 'storage_unavailable',
      reason: 'decrypt_failed',
    });
    expect(
      doctor.inspectSecureSessionFile(sessionPath, secret, now)
    ).toMatchObject({
      state: 'ok',
    });

    writeSecureEnvelope(sessionPath, secret, {
      saved_at: '2026-05-10T11:00:00.000Z',
      cookies: [],
    });
    expect(
      doctor.inspectSecureSessionFile(sessionPath, secret, now)
    ).toMatchObject({
      state: 'stale',
      reason: 'stale',
    });
  });

  it('treats future saved_at timestamps as fresh rather than stale', async () => {
    const doctor = await loadDoctor();
    const result = doctor.classifySavedAt(
      '2026-05-15T13:00:00.000Z',
      new Date('2026-05-15T12:00:00.000Z')
    );

    expect(result).toMatchObject({
      fresh: true,
      reason: 'future_timestamp',
    });
  });

  it('uses Cengage validity reason names for state and meta failures', async () => {
    const doctor = await loadDoctor();
    const dir = makeTempDir();
    const statePath = path.join(dir, 'cengage-state.json');
    const metaPath = path.join(dir, 'cengage-session-meta.json');
    const secret = 'doctor-test-secret-that-is-long-enough';
    const now = new Date('2026-05-15T12:00:00.000Z');

    expect(
      doctor.inspectCengageSessionFiles(statePath, metaPath, secret, now)
    ).toMatchObject({
      state: 'missing_state',
    });

    writeSecureEnvelope(statePath, secret, {
      saved_at: '2026-05-15T11:00:00.000Z',
      storageState: { cookies: [] },
    });
    fs.writeFileSync(metaPath, '{bad json', 'utf8');

    expect(
      doctor.inspectCengageSessionFiles(statePath, metaPath, secret, now)
    ).toMatchObject({
      state: 'invalid_meta',
      reason: 'malformed_json',
    });
  });
});
