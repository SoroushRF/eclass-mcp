import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const EXPECTED_TOOL_COUNT = 25;

function smokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    AUTH_PORT: '0',
    ECLASS_MCP_LOG_LEVEL: 'fatal',
    ECLASS_MCP_SESSION_SECRET: '',
  };
}

describe('MCP stdio smoke', () => {
  it('starts the real entrypoint and lists tools over stdio without auth or browser work', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['-r', 'ts-node/register/transpile-only', 'src/index.ts'],
      cwd: process.cwd(),
      env: smokeEnv(),
      stderr: 'pipe',
    });
    const stderrChunks: string[] = [];
    transport.stderr?.on('data', (chunk) => {
      stderrChunks.push(String(chunk));
    });

    const client = new Client({
      name: 'eclass-mcp-stdio-smoke',
      version: '1.0.0',
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const toolNames = tools.map((tool) => tool.name).sort();

      expect(toolNames).toHaveLength(EXPECTED_TOOL_COUNT);
      expect(toolNames).toContain('cache_health');
      expect(toolNames).toContain('get_assignments');
    } finally {
      await client.close();
      await transport.close();
    }

    expect(stderrChunks.join('')).not.toMatch(/Opening login window/i);
  }, 45000);
});
