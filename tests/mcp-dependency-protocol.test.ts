import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cache, getCacheKey } from '../src/cache/store';
import { createMcpServer } from '../src/index';
import type {
  CengageScraperDependency,
  EclassScraperDependency,
  RmpClientDependency,
  SisScraperDependency,
  ToolDependencies,
} from '../src/tools/dependencies';

type ProtocolHarness = {
  client: Client;
  server: McpServer;
};

const touchedCacheKeys = new Set<string>();
let harness: ProtocolHarness | undefined;

function rememberCacheKey(key: string): string {
  touchedCacheKeys.add(key);
  return key;
}

function uniqueProtocolId(label: string): string {
  return `vitest-mcp-deps-${process.pid}-${Date.now()}-${label}`;
}

function parseFirstTextJson(result: unknown): Record<string, unknown> {
  const content = (
    result as { content?: Array<{ type?: string; text?: string }> }
  ).content;
  const firstBlock = Array.isArray(content) ? content[0] : undefined;
  expect(firstBlock?.type).toBe('text');
  return JSON.parse(firstBlock?.text ?? '{}') as Record<string, unknown>;
}

function createFakeDependencies(): {
  deps: ToolDependencies;
  eclassScraper: EclassScraperDependency;
} {
  const eclassScraper = {
    getCourses: vi.fn(async () => [
      {
        id: 'protocol-course-1',
        name: 'Protocol Injected Course',
        courseCode: 'MCP101',
        url: 'https://eclass.yorku.ca/course/view.php?id=101',
      },
    ]),
    getCourseContent: vi.fn(async (courseId: string) => ({
      courseId,
      sections: [
        {
          id: 'section-1',
          title: 'Protocol Section',
          items: [],
        },
      ],
    })),
    getDeadlines: vi.fn(async (courseId?: string) => [
      {
        id: 'deadline-1',
        name: 'Protocol Deadline',
        dueDate: '2026-06-01T12:00:00.000Z',
        status: 'open',
        courseId: courseId ?? 'all',
        url: 'https://eclass.yorku.ca/mod/assign/view.php?id=101',
      },
    ]),
    getAllAssignmentDeadlines: vi.fn(async (courseId?: string) => [
      {
        id: 'deadline-month-1',
        name: 'Protocol Month Deadline',
        dueDate: '2026-06-01T12:00:00.000Z',
        status: 'open',
        courseId: courseId ?? 'all',
        url: 'https://eclass.yorku.ca/mod/quiz/view.php?id=102',
        type: 'quiz' as const,
      },
    ]),
    getItemDetails: vi.fn(async (url: string) => ({
      kind: 'assign' as const,
      url,
      title: 'Protocol Item',
    })),
    downloadFile: vi.fn(async () => ({
      buffer: Buffer.from('protocol text'),
      mimeType: 'text/plain',
      filename: 'protocol.txt',
    })),
    getSectionText: vi.fn(async (url: string) => ({
      url,
      title: 'Protocol Section Text',
      mainText: 'Protocol body',
      mainLinks: [],
      tabs: [],
    })),
    getGrades: vi.fn(async (courseId?: string) => [
      {
        courseId: courseId ?? 'all',
        itemName: 'Protocol Grade',
        grade: 'A',
        range: '0-100',
        percentage: '95%',
        feedback: '',
      },
    ]),
    getAnnouncements: vi.fn(async () => [
      {
        id: 'protocol-announcement-1',
        title: 'Protocol Announcement',
        content: 'Protocol announcement body',
        date: '2026-06-01',
        author: 'Instructor',
        links: [],
      },
    ]),
  } satisfies EclassScraperDependency;

  const sisScraper = {
    scrapeExams: vi.fn(async () => []),
    scrapeTimetable: vi.fn(async () => []),
  } satisfies SisScraperDependency;

  const rmpClient = {
    searchTeachersWithDiagnostics: vi.fn(async () => ({
      matches: [],
      diagnostics: {
        normalizedName: 'protocol',
        campus: null,
        requestedSchoolIds: [],
        directMatchCount: 0,
        usedCrossCampusProbe: false,
        crossCampusMatchCount: 0,
        suspectedSchoolIdIssue: false,
        attempts: [],
      },
    })),
    getTeacherDetails: vi.fn(async () => null),
  } satisfies RmpClientDependency;

  const cengageScraper = {
    close: vi.fn(async () => undefined),
  } as unknown as CengageScraperDependency;

  return {
    deps: {
      eclassScraper,
      createSisScraper: vi.fn(() => sisScraper),
      createRmpClient: vi.fn(() => rmpClient),
      createCengageScraper: vi.fn(() => cengageScraper),
    },
    eclassScraper,
  };
}

async function createProtocolHarness(
  deps: ToolDependencies
): Promise<ProtocolHarness> {
  const server = createMcpServer(deps);
  const client = new Client({
    name: 'eclass-mcp-dependency-protocol-test',
    version: '0.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

afterEach(async () => {
  for (const key of touchedCacheKeys) {
    cache.invalidate(key);
  }
  touchedCacheKeys.clear();

  if (harness) {
    await Promise.allSettled([harness.client.close(), harness.server.close()]);
    harness = undefined;
  }

  vi.restoreAllMocks();
});

describe('MCP dependency protocol calls', () => {
  it('calls get_course_content through injected eClass dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    const courseId = uniqueProtocolId('content');
    rememberCacheKey(getCacheKey('content', courseId));
    cache.invalidate(getCacheKey('content', courseId));
    harness = await createProtocolHarness(deps);

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_course_content',
        arguments: { courseId },
      })
    );

    expect(payload.courseId).toBe(courseId);
    expect(payload.sections).toEqual([
      expect.objectContaining({ title: 'Protocol Section' }),
    ]);
    expect(eclassScraper.getCourseContent).toHaveBeenCalledWith(courseId);
  });

  it('calls get_upcoming_deadlines through injected eClass dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    const courseId = uniqueProtocolId('upcoming');
    rememberCacheKey(getCacheKey('deadlines', 'upcoming', courseId));
    cache.invalidate(getCacheKey('deadlines', 'upcoming', courseId));
    harness = await createProtocolHarness(deps);

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_upcoming_deadlines',
        arguments: { courseId },
      })
    );

    expect(payload.items).toEqual([
      expect.objectContaining({ name: 'Protocol Deadline' }),
    ]);
    expect(eclassScraper.getDeadlines).toHaveBeenCalledWith(courseId);
  });

  it('calls get_deadlines through injected eClass dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    const courseId = uniqueProtocolId('deadlines');
    rememberCacheKey(getCacheKey('deadlines', 'upcoming', courseId, ''));
    cache.invalidate(getCacheKey('deadlines', 'upcoming', courseId, ''));
    harness = await createProtocolHarness(deps);

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_deadlines',
        arguments: { courseId, scope: 'upcoming' },
      })
    );

    expect(payload.items).toEqual([
      expect.objectContaining({ name: 'Protocol Deadline', type: 'assign' }),
    ]);
    expect(eclassScraper.getDeadlines).toHaveBeenCalledWith(courseId);
  });

  it('calls get_grades through injected eClass dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    const courseId = uniqueProtocolId('grades');
    rememberCacheKey(getCacheKey('grades', courseId));
    cache.invalidate(getCacheKey('grades', courseId));
    harness = await createProtocolHarness(deps);

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_grades',
        arguments: { courseId },
      })
    );

    expect(payload.items).toEqual([
      expect.objectContaining({ itemName: 'Protocol Grade' }),
    ]);
    expect(eclassScraper.getGrades).toHaveBeenCalledWith(courseId);
  });

  it('calls get_announcements through injected eClass dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    const courseId = uniqueProtocolId('announcements');
    rememberCacheKey(getCacheKey('announcements', 'v2', courseId, '2'));
    cache.invalidate(getCacheKey('announcements', 'v2', courseId, '2'));
    harness = await createProtocolHarness(deps);

    const payload = parseFirstTextJson(
      await harness.client.callTool({
        name: 'get_announcements',
        arguments: { courseId, limit: 2 },
      })
    );

    expect(payload.items).toEqual([
      expect.objectContaining({ title: 'Protocol Announcement' }),
    ]);
    expect(eclassScraper.getAnnouncements).toHaveBeenCalledWith(courseId, 2);
  });
});
