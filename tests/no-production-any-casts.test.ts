import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(__dirname, '../src');
const indexPath = path.join(srcRoot, 'index.ts');

function listTypeScriptFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

describe('production source typing guard', () => {
  it('keeps production source free of as-any casts', () => {
    const offenders = listTypeScriptFiles(srcRoot)
      .map((filePath) => ({
        filePath,
        content: fs.readFileSync(filePath, 'utf-8'),
      }))
      .filter(({ content }) => /\bas any\b/.test(content))
      .map(({ filePath }) => path.relative(srcRoot, filePath));

    expect(offenders).toEqual([]);
  });

  it('keeps production source free of explicit any annotations', () => {
    const offenders = listTypeScriptFiles(srcRoot)
      .map((filePath) => ({
        filePath,
        content: fs.readFileSync(filePath, 'utf-8'),
      }))
      .filter(({ content }) => /:\s*any\b|\bany\[\]/.test(content))
      .map(({ filePath }) => path.relative(srcRoot, filePath));

    expect(offenders).toEqual([]);
  });

  it('keeps the MCP entrypoint on typed tool registration', () => {
    const indexSource = fs.readFileSync(indexPath, 'utf-8');

    expect(indexSource).not.toMatch(/server\.tool\(/);
    expect(indexSource).not.toMatch(/:\s*any\b/);
    expect(indexSource).not.toMatch(/\bas any\b/);
    expect(indexSource).not.toMatch(/as CallToolResult/);
    expect(indexSource).not.toMatch(/as unknown as TypedRegisterCallback/);
    expect(indexSource).not.toMatch(/args as ShapeOutput/);
  });
});
