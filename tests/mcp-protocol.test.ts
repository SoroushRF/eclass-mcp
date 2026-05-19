import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearCache: vi.fn(async (scope: string = 'all') => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          ok: true,
          scope,
          clearedCount: 7,
          message: `Mock cleared scope ${scope}`,
        }),
      },
    ],
  })),
  scraper: {
    downloadFile: vi.fn(),
    getSectionText: vi.fn(),
    getItemDetails: vi.fn(),
  },
}));

vi.mock('../src/tools/cache', () => ({
  clearCache: mocks.clearCache,
}));

vi.mock('../src/tools/announcements', () => ({
  getAnnouncements: vi.fn(),
}));

vi.mock('../src/tools/grades', () => ({
  getGrades: vi.fn(),
}));

vi.mock('../src/tools/rmp', () => ({
  searchProfessorsTool: vi.fn(),
  getProfessorDetailsTool: vi.fn(),
}));

vi.mock('../src/scraper/eclass', () => {
  class SessionExpiredError extends Error {}
  class ScrapeLayoutError extends Error {
    context?: Record<string, unknown>;
  }
  class UpstreamError extends Error {
    code = 'UPSTREAM_ERROR';
    httpStatus?: number;
  }

  return {
    scraper: mocks.scraper,
    SessionExpiredError,
    ScrapeLayoutError,
    UpstreamError,
    upstreamErrorFromHttpStatus: vi.fn(),
    upstreamErrorFromUnknown: vi.fn(),
  };
});

import { createMcpServer } from '../src/index';

const EXPECTED_TOOL_NAMES = [
  'cache_delete_pinned',
  'cache_list_pins',
  'cache_pin',
  'cache_refresh_pin',
  'cache_unpin',
  'clear_cache',
  'discover_cengage_links',
  'get_announcements',
  'get_assignments',
  'get_cengage_assignment_details',
  'get_cengage_assignments',
  'get_class_timetable',
  'get_course_content',
  'get_deadlines',
  'get_exam_schedule',
  'get_file_text',
  'get_grades',
  'get_item_details',
  'get_professor_details',
  'get_section_text',
  'get_upcoming_deadlines',
  'list_cengage_courses',
  'list_courses',
  'search_professors',
] as const;

type ProtocolHarness = {
  client: Client;
  server: McpServer;
};

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
type CallToolResponse = Awaited<ReturnType<Client['callTool']>>;

async function createProtocolHarness(): Promise<ProtocolHarness> {
  const server = createMcpServer();
  const client = new Client({
    name: 'eclass-mcp-protocol-test',
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

function toolByName(tools: ListedTool[], name: string): ListedTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

function schemaProperties(tool: ListedTool): Record<string, object> {
  return tool.inputSchema.properties ?? {};
}

function requiredFields(tool: ListedTool): string[] {
  return tool.inputSchema.required ?? [];
}

function isTextContentBlock(
  block: unknown
): block is { type: 'text'; text: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    'text' in block &&
    block.type === 'text' &&
    typeof block.text === 'string'
  );
}

function parseFirstTextJson(result: CallToolResponse): Record<string, unknown> {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('Expected a normal MCP content response.');
  }

  const firstBlock = content[0];
  if (!isTextContentBlock(firstBlock)) {
    throw new Error('Expected first MCP content block to be text.');
  }

  return JSON.parse(firstBlock.text) as Record<string, unknown>;
}

describe('MCP protocol integration', () => {
  let harness: ProtocolHarness | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await closeProtocolHarness(harness);
    harness = null;
  });

  it('lists every public tool through MCP listTools', async () => {
    harness = await createProtocolHarness();

    const { tools } = await harness.client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
    for (const tool of tools) {
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.description?.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('exposes representative input schemas through MCP listTools', async () => {
    harness = await createProtocolHarness();

    const { tools } = await harness.client.listTools();

    const fileText = toolByName(tools, 'get_file_text');
    expect(Object.keys(schemaProperties(fileText))).toEqual(
      expect.arrayContaining(['courseId', 'fileUrl', 'startPage', 'endPage'])
    );
    expect(requiredFields(fileText)).toContain('fileUrl');

    const sectionText = toolByName(tools, 'get_section_text');
    expect(Object.keys(schemaProperties(sectionText))).toEqual(['url']);
    expect(requiredFields(sectionText)).toEqual(['url']);

    const itemDetails = toolByName(tools, 'get_item_details');
    expect(Object.keys(schemaProperties(itemDetails))).toEqual(
      expect.arrayContaining([
        'url',
        'includeImages',
        'maxImages',
        'imageOffset',
        'maxTotalImageBytes',
        'includeCsv',
        'csvMode',
        'maxCsvBytes',
        'csvPreviewLines',
        'maxCsvAttachments',
      ])
    );
    expect(requiredFields(itemDetails)).toContain('url');

    const assignments = toolByName(tools, 'get_assignments');
    expect(Object.keys(schemaProperties(assignments))).toEqual(
      expect.arrayContaining([
        'courseId',
        'courseCode',
        'courseQuery',
        'scope',
        'includeExternal',
        'platformSelection',
      ])
    );

    const cengageAssignments = toolByName(tools, 'get_cengage_assignments');
    expect(Object.keys(schemaProperties(cengageAssignments))).toEqual(
      expect.arrayContaining([
        'entryUrl',
        'ssoUrl',
        'courseId',
        'courseKey',
        'courseQuery',
        'allCourses',
        'maxCourses',
        'maxAssignmentsPerCourse',
      ])
    );

    const cachePin = toolByName(tools, 'cache_pin');
    expect(Object.keys(schemaProperties(cachePin))).toEqual(
      expect.arrayContaining([
        'resource_type',
        'fileUrl',
        'startPage',
        'endPage',
        'url',
        'courseId',
        'note',
      ])
    );
    expect(requiredFields(cachePin)).toContain('resource_type');

    for (const name of [
      'clear_cache',
      'cache_unpin',
      'cache_list_pins',
      'cache_refresh_pin',
      'cache_delete_pinned',
    ]) {
      expect(
        Object.keys(schemaProperties(toolByName(tools, name))).length
      ).toBeGreaterThan(0);
    }
  });

  it('returns structured validation failures for unsafe URL tool calls', async () => {
    harness = await createProtocolHarness();

    const unsafeCalls = [
      {
        name: 'get_file_text',
        arguments: {
          fileUrl: 'https://eclass.yorku.ca.evil.test/pluginfile.php/1/a.pdf',
        },
      },
      {
        name: 'get_section_text',
        arguments: {
          url: 'https://eclass.yorku.ca.evil.test/course/view.php?id=1&section=2',
        },
      },
      {
        name: 'get_item_details',
        arguments: {
          url: 'https://eclass.yorku.ca.evil.test/mod/assign/view.php?id=1',
        },
      },
    ] as const;

    for (const call of unsafeCalls) {
      const payload = parseFirstTextJson(
        await harness.client.callTool({
          name: call.name,
          arguments: call.arguments,
        })
      );

      expect(payload).toMatchObject({
        status: 'error',
        code: 'VALIDATION_FAILED',
      });
    }

    expect(mocks.scraper.downloadFile).not.toHaveBeenCalled();
    expect(mocks.scraper.getSectionText).not.toHaveBeenCalled();
    expect(mocks.scraper.getItemDetails).not.toHaveBeenCalled();
  });

  it('keeps migrated validation failures visible through protocol callTool', async () => {
    harness = await createProtocolHarness();

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_section_text',
        arguments: {
          url: 'https://eclass.yorku.ca.evil.test/course/view.php?id=1&section=2',
        },
      })
    );

    expect(payload.status).toBe('error');
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(typeof payload.message).toBe('string');
    expect(mocks.scraper.getSectionText).not.toHaveBeenCalled();
  });

  it('returns a valid MCP content response for clear_cache', async () => {
    harness = await createProtocolHarness();

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'clear_cache',
        arguments: { scope: 'rmp' },
      })
    );

    expect(payload).toMatchObject({
      ok: true,
      scope: 'rmp',
      clearedCount: 7,
    });
    expect(mocks.clearCache).toHaveBeenCalledWith('rmp');
  });
});
