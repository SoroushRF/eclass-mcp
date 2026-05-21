import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cache, getCacheKey } from '../src/cache/store';
import {
  RMP_CIRCUIT_FAILURE_THRESHOLD,
  resetRmpCircuitBreaker,
} from '../src/scraper/rmp';
import { createMcpServer } from '../src/index';

type ProtocolHarness = {
  client: Client;
  server: McpServer;
};

const touchedCacheKeys = new Set<string>();

function rememberCacheKey(key: string): string {
  touchedCacheKeys.add(key);
  return key;
}

function rateLimitedResponse(): Response {
  return new Response('too many requests', {
    status: 429,
    statusText: 'Too Many Requests',
  });
}

async function createProtocolHarness(): Promise<ProtocolHarness> {
  const server = createMcpServer();
  const client = new Client({
    name: 'eclass-mcp-rmp-protocol-test',
    version: '0.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

async function closeProtocolHarness(
  harness: ProtocolHarness | null
): Promise<void> {
  if (!harness) return;
  await harness.client.close().catch(() => undefined);
  await harness.server.close().catch(() => undefined);
}

function parseFirstTextJson(result: unknown): Record<string, unknown> {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('Expected MCP content response.');
  }
  const firstBlock = content[0];
  if (
    typeof firstBlock !== 'object' ||
    firstBlock === null ||
    !('text' in firstBlock) ||
    typeof firstBlock.text !== 'string'
  ) {
    throw new Error('Expected first MCP content block to be text.');
  }
  return JSON.parse(firstBlock.text) as Record<string, unknown>;
}

describe('RMP MCP protocol circuit breaker', () => {
  let harness: ProtocolHarness | null = null;

  afterEach(async () => {
    await closeProtocolHarness(harness);
    harness = null;
    resetRmpCircuitBreaker();
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }
    touchedCacheKeys.clear();
    vi.restoreAllMocks();
  });

  it('opens the real RMP breaker through protocol callTool and then fails fast', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(rateLimitedResponse()));
    harness = await createProtocolHarness();

    for (let i = 0; i < RMP_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      const teacherId = `protocol-rmp-${process.pid}-${Date.now()}-${i}`;
      rememberCacheKey(getCacheKey('rmp_details', teacherId));

      const payload = parseFirstTextJson(
        await harness.client.callTool({
          name: 'get_professor_details',
          arguments: { teacherId },
        })
      );

      expect(payload).toMatchObject({
        status: 'error',
        code: 'RATE_LIMITED',
      });
    }

    const blockedTeacherId = `protocol-rmp-blocked-${process.pid}-${Date.now()}`;
    rememberCacheKey(getCacheKey('rmp_details', blockedTeacherId));
    const blockedPayload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_professor_details',
        arguments: { teacherId: blockedTeacherId },
      })
    );

    expect(blockedPayload).toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED',
    });
    expect(String(blockedPayload.message)).toContain('temporarily paused');
    expect(fetchSpy).toHaveBeenCalledTimes(RMP_CIRCUIT_FAILURE_THRESHOLD);
  });
});
