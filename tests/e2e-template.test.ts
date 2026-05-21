import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.join(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'e2e-template.mjs');
const runLogPath = path.join(repoRoot, 'docs', 'e2e-run-log.md');
const tempDirs = new Set<string>();

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eclass-e2e-template-'));
  tempDirs.add(dir);
  return dir;
}

function runTemplate(args: string[] = []): string {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('e2e template generator', () => {
  it('prints a current manual release harness template to stdout', () => {
    const output = runTemplate(['--phase', 'Task 10 Harness Smoke']);

    expect(output).toContain('## Run Template - Task 10 Harness Smoke');
    expect(output).toContain('### Environment');
    expect(output).toContain('| Generated at |');
    expect(output).toContain('| OS |');
    expect(output).toContain('| Node version |');
    expect(output).toContain('| Git commit |');
    expect(output).toContain('### Inspector Smoke Matrix');
    expect(output).toContain('### Claude Desktop Matrix');
    expect(output).toContain('Expected public MCP tool count: 25.');
    expect(output).toContain('`cache_health`');
    expect(output).toContain('T41-I1');
    expect(output).toContain('T42-I1');
    expect(output).toContain('Evidence And Redaction Rules');
  });

  it('does not modify the run log during default stdout generation', () => {
    const before = fs.readFileSync(runLogPath, 'utf8');

    runTemplate();

    expect(fs.readFileSync(runLogPath, 'utf8')).toBe(before);
  });

  it('requires explicit append mode before writing an output file', () => {
    const dir = makeTempDir();
    const outputPath = path.join(dir, 'run-log.md');

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--output', outputPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      '--output is only allowed with explicit --append'
    );
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('appends the empty template only when append mode is explicit', () => {
    const dir = makeTempDir();
    const outputPath = path.join(dir, 'run-log.md');
    fs.writeFileSync(outputPath, '# Existing Log\n', 'utf8');

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--phase',
        'Append Smoke',
        '--append',
        '--output',
        outputPath,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(fs.readFileSync(outputPath, 'utf8')).toContain(
      '## Run Template - Append Smoke'
    );
  });

  it('does not emit local paths, session filenames, cache filenames, or user data', () => {
    const output = runTemplate();
    const normalizedRepoRoot = repoRoot.replace(/\\/g, '/');

    expect(output.replace(/\\/g, '/')).not.toContain(normalizedRepoRoot);
    expect(output).not.toContain('.eclass-mcp');
    expect(output).not.toContain('session.json');
    expect(output).not.toContain('cengage-state.json');
    expect(output).not.toContain('pluginfile.php');
    expect(output).not.toMatch(/[A-Za-z]:\\/);
  });
});
