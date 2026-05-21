import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cache, getCacheKey } from '../src/cache/store';
import { scraper as singletonEClassScraper } from '../src/scraper/eclass';
import { UpstreamError } from '../src/scraper/scrape-errors';
import { createMcpServer } from '../src/index';
import { listCourses } from '../src/tools/courses';
import { getCourseContent, getSectionText } from '../src/tools/content';
import { getDeadlines, getItemDetails } from '../src/tools/deadlines';
import { getFileText } from '../src/tools/files';
import { getGrades } from '../src/tools/grades';
import { getAnnouncements } from '../src/tools/announcements';
import { getExamSchedule, getClassTimetable } from '../src/tools/sis';
import {
  getProfessorDetailsTool,
  searchProfessorsTool,
} from '../src/tools/rmp';
import { listCengageCourses } from '../src/tools/cengage';
import { getAssignments } from '../src/tools/assignments';
import type {
  CengageScraperDependency,
  EclassScraperDependency,
  RmpClientDependency,
  SisScraperDependency,
  ToolDependencies,
} from '../src/tools/dependencies';
import {
  SisExamScheduleResponseSchema,
  SisTimetableResponseSchema,
} from '../src/tools/eclass-contracts';

const touchedCacheKeys = new Set<string>();
let protocolHarness: { client: Client; server: McpServer } | undefined =
  undefined;

function rememberCacheKey(key: string): string {
  touchedCacheKeys.add(key);
  return key;
}

function parsePayload(result: unknown) {
  const content = (result as { content: Array<{ text?: string }> }).content;
  return JSON.parse(content[0].text || '{}');
}

function uniqueId(label: string): string {
  return `vitest-di-${process.pid}-${Date.now()}-${label}`;
}

function createFakeDependencies(): {
  deps: ToolDependencies;
  eclassScraper: EclassScraperDependency;
  sisScraper: SisScraperDependency;
  rmpClient: RmpClientDependency;
  cengageScraper: CengageScraperDependency;
  createSisScraper: ReturnType<typeof vi.fn>;
  createRmpClient: ReturnType<typeof vi.fn>;
  createCengageScraper: ReturnType<typeof vi.fn>;
} {
  const eclassScraper = {
    getCourses: vi.fn(async () => [
      {
        id: 'course-1',
        name: 'Injected Course',
        courseCode: 'INJ101',
        url: 'https://eclass.yorku.ca/course/view.php?id=1',
      },
    ]),
    getCourseContent: vi.fn(async (courseId: string) => ({
      courseId,
      sections: [],
    })),
    getDeadlines: vi.fn(async (courseId?: string) => [
      {
        id: 'a1',
        name: 'Injected Assignment',
        dueDate: '2026-05-20T12:00:00.000Z',
        status: 'open',
        courseId: courseId || 'all',
        url: 'https://eclass.yorku.ca/mod/assign/view.php?id=1',
      },
    ]),
    getAllAssignmentDeadlines: vi.fn(async (courseId?: string) => [
      {
        id: 'm1',
        name: 'Injected Month Assignment',
        dueDate: '2026-05-20T12:00:00.000Z',
        status: 'open',
        courseId: courseId || 'all',
        url: 'https://eclass.yorku.ca/mod/assign/view.php?id=2',
        type: 'assign' as const,
      },
    ]),
    getItemDetails: vi.fn(async (url: string) => ({
      kind: 'assign' as const,
      url,
      title: 'Injected Item',
    })),
    downloadFile: vi.fn(async () => ({
      buffer: Buffer.from('plain text'),
      mimeType: 'text/plain',
      filename: 'notes.txt',
    })),
    getSectionText: vi.fn(async (url: string) => ({
      url,
      title: 'Injected Section',
      mainText: 'Injected body',
      mainLinks: [],
      tabs: [],
    })),
    getGrades: vi.fn(async (courseId?: string) => [
      {
        courseId: courseId || 'all',
        itemName: 'Injected Grade',
        grade: 'A',
        range: '0-100',
        percentage: '90%',
        feedback: '',
      },
    ]),
    getAnnouncements: vi.fn(async () => [
      {
        id: 'ann-1',
        title: 'Injected Announcement',
        content: 'Hello',
        date: '2026-05-20',
        author: 'Instructor',
        links: [],
      },
    ]),
  } satisfies EclassScraperDependency;

  const sisScraper = {
    scrapeExams: vi.fn(async () => [
      {
        courseCode: 'INJ 101',
        section: 'A',
        courseTitle: 'Injected Exam',
        date: '2026-06-01',
        startTime: '9:00 AM',
        durationMinutes: 180,
        campus: 'Keele',
        rooms: 'CLH A',
      },
    ]),
    scrapeTimetable: vi.fn(async () => [
      {
        courseCode: 'INJ 101',
        term: 'W',
        section: 'A',
        type: 'LEC',
        days: 'M',
        startTime: '10:00',
        durationMinutes: 90,
        room: 'LAS',
      },
    ]),
  } satisfies SisScraperDependency;

  const rmpClient = {
    searchTeachersWithDiagnostics: vi.fn(async () => ({
      matches: [
        {
          id: 'teacher-1',
          legacyId: 123,
          firstName: 'Ada',
          lastName: 'Lovelace',
          department: 'Computer Science',
          school: { name: 'York University', id: 'school-1' },
        },
      ],
      diagnostics: {
        normalizedName: 'ada lovelace',
        campus: null,
        requestedSchoolIds: ['school-1'],
        directMatchCount: 1,
        usedCrossCampusProbe: false,
        crossCampusMatchCount: 0,
        suspectedSchoolIdIssue: false,
        attempts: [{ schoolId: 'school-1', term: 'ada lovelace' }],
      },
    })),
    getTeacherDetails: vi.fn(async () => ({
      id: 'teacher-1',
      legacyId: 123,
      firstName: 'Ada',
      lastName: 'Lovelace',
      avgRating: 5,
      avgDifficulty: 2,
      numRatings: 10,
      wouldTakeAgainPercent: 100,
      department: 'Computer Science',
      school: { name: 'York University', id: 'school-1' },
      ratings: [],
    })),
  } satisfies RmpClientDependency;

  const cengageScraper = {
    listDashboardCoursesFromSavedSession: vi.fn(async () => [
      {
        courseId: 'cengage-course-1',
        courseKey: 'course-key-1',
        title: 'Injected Cengage Course',
        launchUrl:
          'https://www.webassign.net/web/Student/Assignment-Responses/course',
        platform: 'webassign' as const,
        assignmentsSupported: true,
        confidence: 1,
      },
    ]),
    listDashboardCoursesFromEntryLink: vi.fn(async () => [
      {
        courseId: 'cengage-entry-1',
        courseKey: 'entry-key-1',
        title: 'Injected Entry Course',
        launchUrl:
          'https://www.webassign.net/web/Student/Assignment-Responses/entry',
        platform: 'webassign' as const,
        assignmentsSupported: true,
        confidence: 1,
      },
    ]),
    getAssignmentsForDashboardCourse: vi.fn(
      async (course: { courseId?: string; title: string }) => ({
        selectedCourse: course,
        assignments: [
          {
            id: 'wa-1',
            name: 'Injected WebAssign Assignment',
            dueDate: '2026-05-20',
            dueDateIso: '2026-05-20T00:00:00.000Z',
            courseId: course.courseId,
            courseTitle: course.title,
            status: 'open',
            score: '',
            url: 'https://www.webassign.net/web/Student/Assignment-Responses/wa-1',
            rawText: 'Injected WebAssign Assignment',
          },
        ],
      })
    ),
    close: vi.fn(async () => undefined),
  } as unknown as CengageScraperDependency;

  const createSisScraper = vi.fn(() => sisScraper);
  const createRmpClient = vi.fn(() => rmpClient);
  const createCengageScraper = vi.fn(() => cengageScraper);

  return {
    deps: {
      eclassScraper,
      createSisScraper,
      createRmpClient,
      createCengageScraper,
    },
    eclassScraper,
    sisScraper,
    rmpClient,
    cengageScraper,
    createSisScraper,
    createRmpClient,
    createCengageScraper,
  };
}

async function createProtocolHarness(deps: ToolDependencies): Promise<{
  client: Client;
  server: McpServer;
}> {
  const server = createMcpServer(deps);
  const client = new Client({
    name: 'tool-dependency-test-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

afterEach(async () => {
  for (const key of touchedCacheKeys) {
    cache.invalidate(key);
  }
  touchedCacheKeys.clear();

  if (protocolHarness) {
    await Promise.allSettled([
      protocolHarness.client.close(),
      protocolHarness.server.close(),
    ]);
    protocolHarness = undefined;
  }

  vi.restoreAllMocks();
});

describe('tool dependency injection', () => {
  it('routes low-risk eClass tools through injected scraper dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    const courseId = uniqueId('content');
    const sectionUrl =
      'https://eclass.yorku.ca/course/view.php?id=111&section=2';
    const fileUrl = 'https://eclass.yorku.ca/pluginfile.php/1/notes.txt';
    const gradesCourseId = uniqueId('grades');
    const announcementsCourseId = uniqueId('announcements');

    rememberCacheKey(getCacheKey('courses'));
    rememberCacheKey(getCacheKey('content', courseId));
    rememberCacheKey(getCacheKey('sectiontext', sectionUrl));
    rememberCacheKey(getCacheKey('file', fileUrl));
    rememberCacheKey(getCacheKey('grades', gradesCourseId));
    rememberCacheKey(
      getCacheKey('announcements', 'v2', announcementsCourseId, '3')
    );
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }

    vi.spyOn(singletonEClassScraper, 'getCourses').mockRejectedValue(
      new Error('singleton should not be used')
    );

    expect(parsePayload(await listCourses(deps)).courses[0].name).toBe(
      'Injected Course'
    );
    expect(parsePayload(await getCourseContent(courseId, deps)).courseId).toBe(
      courseId
    );
    expect(parsePayload(await getSectionText(sectionUrl, deps)).title).toBe(
      'Injected Section'
    );
    expect(
      (await getFileText('course', fileUrl, undefined, undefined, deps))
        .content[0].text
    ).toContain('Unsupported file type');
    expect(
      parsePayload(await getGrades(gradesCourseId, deps)).items[0].itemName
    ).toBe('Injected Grade');
    expect(
      parsePayload(await getAnnouncements(announcementsCourseId, 3, deps))
        .items[0].title
    ).toBe('Injected Announcement');

    expect(eclassScraper.getCourses).toHaveBeenCalledTimes(1);
    expect(eclassScraper.getCourseContent).toHaveBeenCalledWith(courseId);
    expect(eclassScraper.getSectionText).toHaveBeenCalledWith(sectionUrl);
    expect(eclassScraper.downloadFile).toHaveBeenCalledWith(fileUrl);
    expect(eclassScraper.getGrades).toHaveBeenCalledWith(gradesCourseId);
    expect(eclassScraper.getAnnouncements).toHaveBeenCalledWith(
      announcementsCourseId,
      3
    );
    expect(singletonEClassScraper.getCourses).not.toHaveBeenCalled();
  });

  it('routes deadline and item detail tools through injected eClass dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    const courseId = uniqueId('deadlines');
    const itemUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=555';

    rememberCacheKey(getCacheKey('deadlines', 'upcoming', courseId, ''));
    rememberCacheKey(getCacheKey('details', 'v2', itemUrl));
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }

    const deadlinesPayload = parsePayload(
      await getDeadlines({ courseId, scope: 'upcoming' }, false, deps)
    );
    const detailsPayload = parsePayload(
      await getItemDetails({ url: itemUrl }, false, deps)
    );

    expect(deadlinesPayload.items[0].name).toBe('Injected Assignment');
    expect(detailsPayload.title).toBe('Injected Item');
    expect(eclassScraper.getDeadlines).toHaveBeenCalledWith(courseId);
    expect(eclassScraper.getItemDetails).toHaveBeenCalledWith(itemUrl);
  });

  it('keeps URL validation ahead of injected scraper calls', async () => {
    const { deps, eclassScraper } = createFakeDependencies();

    const payload = parsePayload(
      await getItemDetails(
        { url: 'https://eclass.yorku.ca.evil.test/mod/assign/view.php?id=1' },
        false,
        deps
      )
    );

    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(eclassScraper.getItemDetails).not.toHaveBeenCalled();
  });

  it('routes SIS tools through the injected scraper factory', async () => {
    const { deps, sisScraper, createSisScraper } = createFakeDependencies();

    expect(parsePayload(await getExamSchedule(deps)).status).toBe('ok');
    expect(parsePayload(await getClassTimetable(deps)).status).toBe('ok');

    expect(createSisScraper).toHaveBeenCalledTimes(2);
    expect(sisScraper.scrapeExams).toHaveBeenCalledTimes(1);
    expect(sisScraper.scrapeTimetable).toHaveBeenCalledTimes(1);
  });

  it('redacts unexpected SIS scraper errors', async () => {
    const { deps, sisScraper } = createFakeDependencies();
    vi.mocked(sisScraper.scrapeExams).mockRejectedValueOnce(
      new Error('secret browser path C:\\Users\\student\\session.json')
    );
    vi.mocked(sisScraper.scrapeTimetable).mockRejectedValueOnce(
      new Error('cookie/session detail')
    );

    const examResult = await getExamSchedule(deps);
    const timetableResult = await getClassTimetable(deps);
    const examPayload = parsePayload(examResult);
    const timetablePayload = parsePayload(timetableResult);
    const examText = examResult.content[0].text ?? '';
    const timetableText = timetableResult.content[0].text ?? '';

    expect(examPayload).toMatchObject({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'The tool failed due to an unexpected internal error.',
    });
    expect(timetablePayload).toMatchObject({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'The tool failed due to an unexpected internal error.',
    });
    expect(examText).not.toContain('secret browser path');
    expect(timetableText).not.toContain('cookie/session detail');
    expect(SisExamScheduleResponseSchema.safeParse(examPayload).success).toBe(
      true
    );
    expect(SisTimetableResponseSchema.safeParse(timetablePayload).success).toBe(
      true
    );
  });

  it('routes RMP tools through the injected client factory', async () => {
    const { deps, rmpClient, createRmpClient } = createFakeDependencies();
    const professorName = uniqueId('ada lovelace');
    const normalizedName = professorName.trim().replace(/\s+/g, ' ');

    rememberCacheKey(
      getCacheKey('rmp_search', normalizedName.toLowerCase(), 'all')
    );
    rememberCacheKey(getCacheKey('rmp_details', 'teacher-1'));
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }

    const searchPayload = parsePayload(
      await searchProfessorsTool({ name: professorName }, deps)
    );
    const detailsPayload = parsePayload(
      await getProfessorDetailsTool({ teacherId: 'teacher-1' }, deps)
    );
    const validationPayload = parsePayload(
      await searchProfessorsTool({}, deps)
    );

    expect(searchPayload.matches[0].name).toBe('Ada Lovelace');
    expect(detailsPayload.professor.name).toBe('Ada Lovelace');
    expect(validationPayload.code).toBe('VALIDATION_FAILED');
    expect(createRmpClient).toHaveBeenCalledTimes(2);
    expect(rmpClient.searchTeachersWithDiagnostics).toHaveBeenCalledWith(
      professorName,
      undefined
    );
    expect(rmpClient.getTeacherDetails).toHaveBeenCalledWith('teacher-1');
  });

  it('redacts unexpected RMP client errors as tool JSON', async () => {
    const { deps, rmpClient } = createFakeDependencies();
    const professorName = uniqueId('raw upstream internals');
    const normalizedName = professorName.trim().replace(/\s+/g, ' ');
    rememberCacheKey(
      getCacheKey('rmp_search', normalizedName.toLowerCase(), 'all')
    );
    rememberCacheKey(getCacheKey('rmp_details', 'secret-detail-teacher'));
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }

    vi.mocked(rmpClient.searchTeachersWithDiagnostics).mockRejectedValueOnce(
      new Error('raw upstream internals')
    );
    vi.mocked(rmpClient.getTeacherDetails).mockRejectedValueOnce(
      new Error('raw detail internals')
    );

    const searchResult = await searchProfessorsTool(
      { name: professorName },
      deps
    );
    const detailsResult = await getProfessorDetailsTool(
      { teacherId: 'secret-detail-teacher' },
      deps
    );
    const searchPayload = parsePayload(searchResult);
    const detailsPayload = parsePayload(detailsResult);
    const searchText = searchResult.content[0].text ?? '';
    const detailsText = detailsResult.content[0].text ?? '';

    expect(searchPayload).toMatchObject({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'The tool failed due to an unexpected internal error.',
    });
    expect(detailsPayload).toMatchObject({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'The tool failed due to an unexpected internal error.',
    });
    expect(searchText).not.toContain('raw upstream internals');
    expect(detailsText).not.toContain('raw detail internals');
  });

  it('routes Cengage tools through the injected scraper factory', async () => {
    const { deps, cengageScraper, createCengageScraper } =
      createFakeDependencies();
    const entryUrl = `https://www.cengage.com/dashboard/home?vitest=${uniqueId('cengage')}`;

    const payload = parsePayload(await listCengageCourses({ entryUrl }, deps));

    expect(payload.courses[0].title).toBe('Injected Entry Course');
    expect(createCengageScraper).toHaveBeenCalledTimes(1);
    expect(
      cengageScraper.listDashboardCoursesFromEntryLink
    ).toHaveBeenCalledWith(entryUrl);
    expect(cengageScraper.close).toHaveBeenCalledTimes(1);
  });

  it('routes get_assignments through injected eClass dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    rememberCacheKey(getCacheKey('courses'));
    rememberCacheKey(getCacheKey('deadlines', 'upcoming', 'course-1', ''));
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }

    await getAssignments(
      {
        courseId: 'course-1',
        includeExternal: 'never',
      },
      false,
      false,
      deps
    );

    expect(eclassScraper.getCourses).toHaveBeenCalled();
    expect(eclassScraper.getDeadlines).toHaveBeenCalledWith('course-1');
  });

  it('maps assignment upstream errors to stable machine-code JSON', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    rememberCacheKey(getCacheKey('courses'));
    rememberCacheKey(getCacheKey('deadlines', 'upcoming', 'course-1', ''));
    for (const key of touchedCacheKeys) {
      cache.invalidate(key);
    }
    vi.mocked(eclassScraper.getDeadlines).mockRejectedValueOnce(
      new UpstreamError('TIMEOUT', 'eClass upstream timed out', 504)
    );

    const payload = parsePayload(
      await getAssignments(
        {
          courseId: 'course-1',
          includeExternal: 'never',
        },
        false,
        false,
        deps
      )
    );

    expect(payload).toMatchObject({
      status: 'error',
      code: 'TIMEOUT',
      message: 'eClass upstream timed out',
      assignments: [],
      sources: expect.any(Object),
      platformIndex: expect.any(Object),
    });
    expect(eclassScraper.getDeadlines).toHaveBeenCalledWith('course-1');
  });

  it('lets MCP server registration close over injected dependencies', async () => {
    const { deps, eclassScraper } = createFakeDependencies();
    rememberCacheKey(getCacheKey('courses'));
    cache.invalidate(getCacheKey('courses'));

    protocolHarness = await createProtocolHarness(deps);
    const payload = parsePayload(
      await protocolHarness.client.callTool({ name: 'list_courses' })
    );

    expect(payload.courses[0].name).toBe('Injected Course');
    expect(eclassScraper.getCourses).toHaveBeenCalledTimes(1);
  });
});
