import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cache } from '../src/cache/store';
import { cengageCacheKey } from '../src/tools/cengage/cache';
import {
  clearActiveEclassAccountScope,
  setActiveEclassAccountScope,
} from '../src/cache/account-scope';
import type {
  CengageScraperDependency,
  RmpClientDependency,
  ToolDependencies,
} from '../src/tools/dependencies';

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
  searchProfessorsTool: vi.fn(async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'error',
          code: 'RATE_LIMITED',
          message: 'RMP requests are temporarily paused.',
        }),
      },
    ],
  })),
  getProfessorDetailsTool: vi.fn(async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'error',
          code: 'RATE_LIMITED',
          message: 'RMP detail requests are temporarily paused.',
        }),
      },
    ],
  })),
  getAssignments: vi.fn(async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: 'from and to are required when scope=range',
          assignments: [],
          sources: {
            eclass: {
              checked: false,
              status: 'not_checked',
              assignmentCount: 0,
            },
            cengage: {
              checked: false,
              status: 'not_checked',
              assignmentCount: 0,
            },
          },
        }),
      },
    ],
  })),
  scraper: {
    downloadFile: vi.fn(),
    getSectionText: vi.fn(),
    getItemDetails: vi.fn(),
    getAssignmentSubmissionPreflight: vi.fn(),
  },
}));

vi.mock('../src/tools/cache', async () => {
  const actual =
    await vi.importActual<typeof import('../src/tools/cache')>(
      '../src/tools/cache'
    );
  return {
    ...actual,
    clearCache: mocks.clearCache,
  };
});

vi.mock('../src/tools/assignments', () => ({
  getAssignments: mocks.getAssignments,
}));

vi.mock('../src/tools/announcements', () => ({
  getAnnouncements: vi.fn(),
}));

vi.mock('../src/tools/grades', () => ({
  getGrades: vi.fn(),
}));

vi.mock('../src/tools/rmp', () => ({
  searchProfessorsTool: mocks.searchProfessorsTool,
  getProfessorDetailsTool: mocks.getProfessorDetailsTool,
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
  'cache_health',
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
  'prepare_assignment_submission',
  'search_professors',
] as const;

type ProtocolHarness = {
  client: Client;
  server: McpServer;
};

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
type CallToolResponse = Awaited<ReturnType<Client['callTool']>>;

const touchedCacheKeys = new Set<string>();

function rememberCacheKey(key: string): string {
  touchedCacheKeys.add(key);
  return key;
}

function uniqueProtocolId(label: string): string {
  return `vitest-mcp-${process.pid}-${Date.now()}-${label}`;
}

function createFakeProtocolDependencies(): {
  deps: ToolDependencies;
  sisScraper: {
    scrapeExams: ReturnType<typeof vi.fn>;
    scrapeTimetable: ReturnType<typeof vi.fn>;
  };
  cengageScraper: CengageScraperDependency;
  createCengageScraper: ReturnType<typeof vi.fn>;
} {
  const sisScraper = {
    scrapeExams: vi.fn(async () => [
      {
        courseCode: 'MCP 101',
        section: 'A',
        courseTitle: 'Protocol Exam',
        date: '2026-06-01',
        startTime: '9:00 AM',
        durationMinutes: 180,
        campus: 'Keele',
        rooms: 'CLH A',
      },
    ]),
    scrapeTimetable: vi.fn(async () => [
      {
        courseCode: 'MCP 101',
        term: 'W',
        section: 'A',
        type: 'LEC',
        days: 'M',
        startTime: '10:00',
        durationMinutes: 90,
        room: 'LAS',
      },
    ]),
  };

  const cengageScraper = {
    listDashboardCoursesFromEntryLink: vi.fn(async () => [
      {
        courseId: 'protocol-cengage-course',
        courseKey: 'protocol-course-key',
        title: 'Protocol Cengage Course',
        launchUrl:
          'https://www.webassign.net/web/Student/Assignment-Responses/protocol',
        platform: 'webassign' as const,
        assignmentsSupported: true,
        confidence: 1,
      },
    ]),
    close: vi.fn(async () => undefined),
  } as unknown as CengageScraperDependency;

  const createCengageScraper = vi.fn(() => cengageScraper);

  return {
    deps: {
      eclassScraper:
        mocks.scraper as unknown as ToolDependencies['eclassScraper'],
      createSisScraper: vi.fn(() => sisScraper),
      createRmpClient: vi.fn(() => ({}) as RmpClientDependency),
      createCengageScraper,
    },
    sisScraper,
    cengageScraper,
    createCengageScraper,
  };
}

async function createProtocolHarness(
  deps?: ToolDependencies
): Promise<ProtocolHarness> {
  const server = createMcpServer(deps);
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
    setActiveEclassAccountScope('https://eclass.yorku.ca', '123456');
  });

  afterEach(async () => {
    await closeProtocolHarness(harness);
    harness = null;
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }
    touchedCacheKeys.clear();
    clearActiveEclassAccountScope();
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

    const preflight = toolByName(tools, 'prepare_assignment_submission');
    expect(Object.keys(schemaProperties(preflight))).toEqual(
      expect.arrayContaining([
        'platform',
        'assignmentUrl',
        'entryUrl',
        'ssoUrl',
        'courseId',
        'courseKey',
        'courseCode',
        'courseQuery',
        'assignmentId',
        'assignmentQuery',
        'intendedFiles',
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

  it('returns a valid mocked MCP content response for destructive clear_cache', async () => {
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

  it('routes injected SIS tools through protocol callTool without browser work', async () => {
    const { deps, sisScraper } = createFakeProtocolDependencies();
    harness = await createProtocolHarness(deps);

    const exams = parseFirstTextJson(
      await harness.client.callTool({ name: 'get_exam_schedule' })
    );
    const timetable = parseFirstTextJson(
      await harness.client.callTool({ name: 'get_class_timetable' })
    );

    expect(exams).toMatchObject({
      status: 'ok',
      exams: [expect.objectContaining({ courseCode: 'MCP 101' })],
    });
    expect(timetable).toMatchObject({
      status: 'ok',
      entries: [expect.objectContaining({ courseCode: 'MCP 101' })],
    });
    expect(sisScraper.scrapeExams).toHaveBeenCalledTimes(1);
    expect(sisScraper.scrapeTimetable).toHaveBeenCalledTimes(1);
  });

  it('routes injected Cengage course listing through protocol callTool', async () => {
    const { deps, createCengageScraper, cengageScraper } =
      createFakeProtocolDependencies();
    const entryUrl = `https://www.cengage.com/dashboard/home?protocol=${uniqueProtocolId('cengage')}`;
    const cacheKey = rememberCacheKey(
      cengageCacheKey('list_courses', {
        entryUrl,
        discoveredLink: null,
        courseQuery: null,
      })
    );
    cache.invalidate(cacheKey);
    harness = await createProtocolHarness(deps);

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'list_cengage_courses',
        arguments: { entryUrl },
      })
    );

    expect(payload).toMatchObject({
      status: 'ok',
      courses: [expect.objectContaining({ title: 'Protocol Cengage Course' })],
    });
    expect(createCengageScraper).toHaveBeenCalledTimes(1);
    expect(
      cengageScraper.listDashboardCoursesFromEntryLink
    ).toHaveBeenCalledWith(entryUrl);
    expect(cengageScraper.close).toHaveBeenCalledTimes(1);
  });

  it('returns a valid MCP content response for cache_health', async () => {
    harness = await createProtocolHarness();

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'cache_health',
      })
    );

    expect(payload).toMatchObject({
      ok: true,
      schema_version: 1,
      cache: { location: '.eclass-mcp/cache' },
    });
    expect(payload).toHaveProperty('pins');
    expect(payload).toHaveProperty('metrics');
  });

  it('returns a valid read-only MCP content response for cache_list_pins', async () => {
    harness = await createProtocolHarness();

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'cache_list_pins',
        arguments: {},
      })
    );

    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.pins)).toBe(true);
    expect(payload.quota).toEqual(expect.any(Object));
  });

  it('rejects invalid Cengage discovery arguments before browser or auth work', async () => {
    harness = await createProtocolHarness();

    const result = await harness.client.callTool({
      name: 'discover_cengage_links',
      arguments: { text: '' },
    });
    const content = (result as { content?: unknown }).content;
    const firstBlock = Array.isArray(content) ? content[0] : undefined;

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(isTextContentBlock(firstBlock)).toBe(true);
    expect(isTextContentBlock(firstBlock) ? firstBlock.text : '').toContain(
      'Input validation error'
    );
  });

  it('returns structured assignment validation through protocol callTool', async () => {
    harness = await createProtocolHarness();

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_assignments',
        arguments: { scope: 'range' },
      })
    );

    expect(payload).toMatchObject({
      status: 'error',
      code: 'VALIDATION_FAILED',
    });
    expect(mocks.getAssignments).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'range' }),
      false,
      false,
      expect.any(Object)
    );
  });

  it('routes assignment submission preflight through protocol callTool', async () => {
    const originalSecret = process.env.ECLASS_MCP_SESSION_SECRET;
    process.env.ECLASS_MCP_SESSION_SECRET = 'protocol-secret'.repeat(3);
    mocks.scraper.getAssignmentSubmissionPreflight.mockResolvedValueOnce({
      kind: 'assign',
      url: 'https://eclass.yorku.ca/mod/assign/view.php?id=777',
      title: 'Protocol Preflight',
      courseId: 'protocol-course',
      cmId: '777',
      submissionState: 'Draft',
      canEditSubmission: true,
      isFinalized: false,
      uploadSlots: [
        {
          kind: 'file',
          label: 'File submissions',
          canUpload: true,
        },
      ],
    });
    try {
      const { deps } = createFakeProtocolDependencies();
      harness = await createProtocolHarness(deps);

      const payload = parseFirstTextJson(
        await harness.client.callTool({
          name: 'prepare_assignment_submission',
          arguments: {
            assignmentUrl: 'https://eclass.yorku.ca/mod/assign/view.php?id=777',
          },
        })
      );

      expect(payload).toMatchObject({
        status: 'ok',
        platform: 'eclass',
        assignment: expect.objectContaining({ title: 'Protocol Preflight' }),
      });
      expect(payload.preflightRef).toEqual(expect.any(String));
      expect(mocks.scraper.getAssignmentSubmissionPreflight).toHaveBeenCalled();
    } finally {
      if (originalSecret === undefined) {
        delete process.env.ECLASS_MCP_SESSION_SECRET;
      } else {
        process.env.ECLASS_MCP_SESSION_SECRET = originalSecret;
      }
    }
  });

  it('returns structured RMP circuit-open errors through protocol callTool', async () => {
    harness = await createProtocolHarness();

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'search_professors',
        arguments: { name: 'Example Professor' },
      })
    );

    expect(payload).toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED',
    });
    expect(mocks.searchProfessorsTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Example Professor' }),
      expect.any(Object)
    );
  });

  it('returns structured RMP detail errors through protocol callTool', async () => {
    harness = await createProtocolHarness();

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_professor_details',
        arguments: { teacherId: '12345' },
      })
    );

    expect(payload).toMatchObject({
      status: 'error',
      code: 'RATE_LIMITED',
    });
    expect(mocks.getProfessorDetailsTool).toHaveBeenCalledWith(
      expect.objectContaining({ teacherId: '12345' }),
      expect.any(Object)
    );
  });
});
