import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from 'vitest';

interface ClaudeConfigModule {
  buildEclassServerConfig(options: { nodePath: string; distPath: string }): {
    command: string;
    args: string[];
  };
  createConfigDiff(currentText: string, proposedText: string): string;
  formatClaudeConfig(config: unknown): string;
  getBackupPath(configPath: string, date?: Date): string;
  listClaudeConfigBackups(configPath: string): string[];
  mergeClaudeConfig(
    existingConfig: Record<string, unknown>,
    serverConfig: Record<string, unknown>
  ): Record<string, any>;
  parseClaudeConfigText(raw: string | undefined, source?: string): unknown;
  resolveRestoreBackup(configPath: string, value: string): string;
  validateBackupPath(configPath: string, backupPath: string): string;
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eclass-mcp-setup-'));
  tempDirs.push(dir);
  return dir;
}

async function loadClaudeConfig(): Promise<ClaudeConfigModule> {
  const url = pathToFileURL(
    path.join(__dirname, '..', 'scripts', 'lib', 'claude-config.mjs')
  ).href;
  return (await import(url)) as ClaudeConfigModule;
}

function runSetupScript(
  args: string[],
  configPath: string
): { stdout: string; stderr: string } {
  const stdout = execFileSync(
    process.execPath,
    ['scripts/setup.mjs', ...args],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        ECLASS_MCP_CLAUDE_CONFIG_PATH: configPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  return { stdout, stderr: '' };
}

function expectSetupFailure(args: string[], configPath: string): string {
  try {
    runSetupScript(args, configPath);
  } catch (error: any) {
    return `${error.stdout || ''}${error.stderr || ''}`;
  }
  throw new Error('Expected setup script to fail');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Claude config setup helpers', () => {
  it('merges eclass server while preserving unrelated config', async () => {
    const helper = await loadClaudeConfig();
    const server = helper.buildEclassServerConfig({
      nodePath: 'node-path',
      distPath: 'C:\\repo\\dist\\index.js',
    });

    const merged = helper.mergeClaudeConfig(
      {
        theme: 'dark',
        mcpServers: {
          other: { command: 'other-node', args: ['server.js'] },
          eclass: { command: 'old-node', args: ['old.js'] },
        },
      },
      server
    );

    expect(merged).toEqual({
      theme: 'dark',
      mcpServers: {
        other: { command: 'other-node', args: ['server.js'] },
        eclass: { command: 'node-path', args: ['C:\\repo\\dist\\index.js'] },
      },
    });
  });

  it('treats missing and empty config as a fresh mcpServers object', async () => {
    const helper = await loadClaudeConfig();

    expect(helper.parseClaudeConfigText(undefined)).toEqual({
      mcpServers: {},
    });
    expect(helper.parseClaudeConfigText('   \n')).toEqual({
      mcpServers: {},
    });
  });

  it('rejects malformed JSON and unsafe mcpServers shapes', async () => {
    const helper = await loadClaudeConfig();

    expect(() => helper.parseClaudeConfigText('{bad json')).toThrow(
      /malformed JSON/
    );
    expect(() =>
      helper.mergeClaudeConfig(
        { mcpServers: [] },
        { command: 'node', args: [] }
      )
    ).toThrow(/mcpServers must be an object/);
  });

  it('formats backup names, filters backups, and resolves latest', async () => {
    const helper = await loadClaudeConfig();
    const root = makeTempDir();
    const configPath = path.join(root, 'claude_desktop_config.json');
    const older = path.join(
      root,
      'claude_desktop_config.json.20260515-010203.bak'
    );
    const newer = path.join(
      root,
      'claude_desktop_config.json.20260515-020304.bak'
    );
    fs.writeFileSync(older, '{}', 'utf8');
    fs.writeFileSync(newer, '{}', 'utf8');
    fs.writeFileSync(path.join(root, 'claude_desktop_config.json.bak'), '{}');

    expect(
      helper.getBackupPath(configPath, new Date('2026-05-15T02:15:30'))
    ).toMatch(/claude_desktop_config\.json\.20260515-\d{6}\.bak$/);
    expect(helper.listClaudeConfigBackups(configPath)).toEqual([newer, older]);
    expect(helper.resolveRestoreBackup(configPath, 'latest')).toBe(newer);
  });

  it('rejects restore paths outside the selected config directory', async () => {
    const helper = await loadClaudeConfig();
    const root = makeTempDir();
    const configPath = path.join(root, 'claude_desktop_config.json');
    const outside = path.join(
      makeTempDir(),
      'claude_desktop_config.json.20260515-020304.bak'
    );
    const wrongName = path.join(root, 'wrong-name.20260515-020304.bak');

    expect(() => helper.validateBackupPath(configPath, outside)).toThrow(
      /beside the selected Claude config/
    );
    expect(() => helper.validateBackupPath(configPath, wrongName)).toThrow(
      /must match/
    );
  });

  it('prints changed eclass targets in config diffs', async () => {
    const helper = await loadClaudeConfig();
    const before = helper.formatClaudeConfig({
      mcpServers: { eclass: { command: 'old-node', args: ['old.js'] } },
    });
    const after = helper.formatClaudeConfig({
      mcpServers: { eclass: { command: 'new-node', args: ['dist/index.js'] } },
    });

    const diff = helper.createConfigDiff(before, after);

    expect(diff).toContain('-       "command": "old-node"');
    expect(diff).toContain('+       "command": "new-node"');
    expect(diff).toContain('dist/index.js');
  });
});

describe('setup script CLI behavior', () => {
  it('dry-run prints proposed config without creating files', () => {
    const root = makeTempDir();
    const configPath = path.join(root, 'missing', 'claude_desktop_config.json');

    const { stdout } = runSetupScript(['--dry-run'], configPath);

    expect(stdout).toContain('eclass-mcp setup dry run');
    expect(stdout).toContain('Proposed eclass:');
    expect(stdout).toContain('dist');
    expect(fs.existsSync(path.dirname(configPath))).toBe(false);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('dry-run with stale config prints the old and proposed target', () => {
    const root = makeTempDir();
    const configPath = path.join(root, 'claude_desktop_config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            eclass: { command: 'old-node', args: ['C:\\old\\dist\\index.js'] },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const { stdout } = runSetupScript(['--dry-run'], configPath);

    expect(stdout).toContain('old-node');
    expect(stdout).toContain(process.execPath);
    expect(fs.readFileSync(configPath, 'utf8')).toContain('old-node');
  });

  it('normal setup creates no backup for a new config and writes atomically', () => {
    const root = makeTempDir();
    const configPath = path.join(root, 'claude_desktop_config.json');

    runSetupScript([], configPath);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcpServers.eclass.command).toBe(process.execPath);
    expect(config.mcpServers.eclass.args[0]).toMatch(/dist[\\/]index\.js$/);
    expect(
      fs.readdirSync(root).filter((name) => name.endsWith('.bak'))
    ).toEqual([]);
    expect(
      fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))
    ).toEqual([]);
  });

  it('normal setup backs up an existing config before replacing eclass only', () => {
    const root = makeTempDir();
    const configPath = path.join(root, 'claude_desktop_config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          other: { command: 'other-node', args: ['server.js'] },
          eclass: { command: 'old-node', args: ['old.js'] },
        },
      }),
      'utf8'
    );

    runSetupScript([], configPath);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const backups = fs
      .readdirSync(root)
      .filter((name) => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect(config.mcpServers.other.command).toBe('other-node');
    expect(config.mcpServers.eclass.command).toBe(process.execPath);
    expect(fs.readFileSync(path.join(root, backups[0]), 'utf8')).toContain(
      'old-node'
    );
  });

  it('lists backups and restores the newest backup with a pre-restore backup', () => {
    const root = makeTempDir();
    const configPath = path.join(root, 'claude_desktop_config.json');
    fs.writeFileSync(
      configPath,
      '{"mcpServers":{"eclass":{"command":"current"}}}',
      'utf8'
    );
    fs.writeFileSync(
      path.join(root, 'claude_desktop_config.json.20260515-010203.bak'),
      '{"mcpServers":{"eclass":{"command":"older"}}}',
      'utf8'
    );
    fs.writeFileSync(
      path.join(root, 'claude_desktop_config.json.20260515-020304.bak'),
      '{"mcpServers":{"eclass":{"command":"newer"}}}',
      'utf8'
    );

    const list = runSetupScript(['--list-backups'], configPath).stdout;
    expect(list.indexOf('20260515-020304')).toBeLessThan(
      list.indexOf('20260515-010203')
    );

    runSetupScript(['--restore', 'latest'], configPath);

    const restored = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const backups = fs
      .readdirSync(root)
      .filter((name) => name.endsWith('.bak'));
    expect(restored.mcpServers.eclass.command).toBe('newer');
    expect(backups.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects malformed backups and unknown flags without overwriting config', () => {
    const root = makeTempDir();
    const configPath = path.join(root, 'claude_desktop_config.json');
    const backupPath = path.join(
      root,
      'claude_desktop_config.json.20260515-010203.bak'
    );
    fs.writeFileSync(
      configPath,
      '{"mcpServers":{"eclass":{"command":"current"}}}',
      'utf8'
    );
    fs.writeFileSync(backupPath, '{bad json', 'utf8');

    const restoreOutput = expectSetupFailure(
      ['--restore', backupPath],
      configPath
    );
    expect(restoreOutput).toContain('malformed JSON');
    expect(fs.readFileSync(configPath, 'utf8')).toContain('current');

    const flagOutput = expectSetupFailure(['--bogus'], configPath);
    expect(flagOutput).toContain('Unknown setup argument');
  });
});
