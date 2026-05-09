import fs from 'fs';
import path from 'path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as authServer from '../src/auth/server';
import { cache, getCacheKey } from '../src/cache/store';
import { CengageScraper } from '../src/scraper/cengage';
import { CengageCourseActivationError } from '../src/scraper/cengage-errors';
import * as cengageSession from '../src/scraper/cengage-session';
import { scraper } from '../src/scraper/eclass';
import { CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY } from '../src/tools/cengage/service';
import { getAssignments } from '../src/tools/assignments';
import {
  getCoursePlatformRecord,
  getCoursePlatformIndexPath,
  invalidateCoursePlatformIndexMemoryCache,
  upsertCoursePlatformMapping,
} from '../src/tools/assignments/platform-index';

const indexPath = getCoursePlatformIndexPath();
let originalIndexContent: string | null = null;
let seq = 0;

function parsePayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function nextCourse(tag: string) {
  seq += 1;
  const id = `t41-${tag}-${Date.now()}-${seq}`;
  return {
    id,
    name: `MATH 1014 O ${tag}`,
    courseCode: 'MATH1014',
    url: `https://eclass.yorku.ca/course/view.php?id=${id}`,
  };
}

function cleanupIndexArtifacts(): void {
  invalidateCoursePlatformIndexMemoryCache();
  if (fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
  }
  const tmpPath = `${indexPath}.${process.pid}.tmp`;
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
}

function invalidateCourseCaches(courseId: string): void {
  cache.invalidate(getCacheKey('courses'));
  cache.invalidate(getCacheKey('deadlines', 'upcoming', courseId, ''));
  cache.invalidate(CENGAGE_DASHBOARD_INVENTORY_CACHE_KEY);
}

function withContext(assignments: any[]) {
  return {
    assignments,
    context: {
      pageUrl: 'https://www.webassign.net/v4cgi/student.pl?course=math',
      pageTitle: 'MATH 1014 O - My Assignments | WebAssign',
      currentSelected: '1226089,1607530',
      currentCourseTitle: 'MATH 1014 O',
      courseMenuLinks: [],
    },
  };
}

beforeAll(() => {
  if (fs.existsSync(indexPath)) {
    originalIndexContent = fs.readFileSync(indexPath, 'utf-8');
  }
});

beforeEach(() => {
  cleanupIndexArtifacts();
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanupIndexArtifacts();
});

afterAll(() => {
  cleanupIndexArtifacts();
  if (originalIndexContent !== null) {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, originalIndexContent, 'utf-8');
  }
  invalidateCoursePlatformIndexMemoryCache();
});

describe('get_assignments resolver', () => {
  it('returns eClass assignments without forcing Cengage auth when eClass is non-empty', async () => {
    const course = nextCourse('eclass-only');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([
      {
        id: 'eclass-1',
        name: 'eClass Homework',
        dueDate: '2026-04-20T12:00:00.000Z',
        status: 'Upcoming',
        courseId: course.id,
        courseName: course.name,
        courseCode: course.courseCode,
        url: 'https://eclass.yorku.ca/mod/assign/view.php?id=1',
      },
    ] as any);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: false,
      reason: 'missing_state',
      statePath: 'state',
      metaPath: 'meta',
    });
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('ok');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.sources.cengage.status).toBe('not_checked');
    expect(openAuthSpy).not.toHaveBeenCalledWith('cengage');
  });

  it('opens Cengage auth and returns needs_external_auth when eClass is empty and auth times out', async () => {
    const course = nextCourse('auth-timeout');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([]);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: false,
      reason: 'missing_state',
      statePath: 'state',
      metaPath: 'meta',
    });
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForCengageAuthSession').mockResolvedValue(false);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth-cengage'
    );

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('needs_external_auth');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry.authUrl).toContain('/auth-cengage');
    expect(payload.platformIndex.mappingStatus).toBe('auth_required');
    expect(openAuthSpy).toHaveBeenCalledWith('cengage');
  });

  it('waits for Cengage auth, retries dashboard matching, returns assignments, and writes the index', async () => {
    const course = nextCourse('auth-success');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([]);
    vi.spyOn(cengageSession, 'getCengageSessionValidity')
      .mockReturnValueOnce({
        valid: false,
        reason: 'missing_state',
        statePath: 'state',
        metaPath: 'meta',
      })
      .mockReturnValue({
        valid: true,
        reason: 'ok',
        statePath: 'state',
        metaPath: 'meta',
      });
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForCengageAuthSession').mockResolvedValue(true);
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([
      {
        title: 'MATH 1014 O',
        courseKey: 'WA-production-1607530',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockResolvedValue(
      withContext([
        {
          id: 'wa-1',
          name: 'WebAssign Homework',
          dueDate: '2026-04-22 23:59',
          status: 'Pending',
          url: '/assignment/wa-1',
        } as any,
      ])
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('ok');
    expect(payload.assignments[0].platform).toBe('webassign');
    expect(payload.sources.cengage.selectedCourse.courseKey).toBe(
      'WA-production-1607530'
    );
    expect(payload.platformIndex.mappingStatus).toBe('linked');
    expect(fs.existsSync(indexPath)).toBe(true);
  });

  it('returns needs_course_selection when Cengage matching is ambiguous', async () => {
    const course = nextCourse('ambiguous');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([]);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'state',
      metaPath: 'meta',
    });
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([
      {
        title: 'MATH 1014 O',
        courseKey: 'WA-production-1',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1',
        platform: 'webassign',
        confidence: 0.95,
      },
      {
        title: 'MATH 1014 N',
        courseKey: 'WA-production-2',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-2',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('needs_course_selection');
    expect(payload.sources.cengage.candidates).toHaveLength(2);
    expect(assignmentsSpy).not.toHaveBeenCalled();
  });

  it('uses a linked platform index record without re-matching dashboard courses', async () => {
    const course = nextCourse('index-hit');
    invalidateCourseCaches(course.id);
    upsertCoursePlatformMapping({
      eclass: {
        courseId: course.id,
        courseCode: course.courseCode,
        courseName: course.name,
      },
      cengage: {
        status: 'linked',
        courseKey: 'WA-production-linked',
        title: 'MATH 1014 O',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-linked',
        platform: 'webassign',
        selectedBy: 'user_selection',
      },
    });

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([]);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'state',
      metaPath: 'meta',
    });
    const dashboardSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromSavedSession')
      .mockResolvedValue([]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(
        withContext([
          {
            id: 'linked-1',
            name: 'Linked Homework',
            dueDate: '2026-04-22 23:59',
            status: 'Pending',
            url: '/assignment/linked-1',
          } as any,
        ])
      );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('ok');
    expect(payload.platformIndex.hit).toBe(true);
    expect(payload.sources.cengage.selectedCourse.courseKey).toBe(
      'WA-production-linked'
    );
    expect(dashboardSpy).not.toHaveBeenCalled();
    expect(assignmentsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        courseKey: 'WA-production-linked',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-linked',
      }),
      expect.objectContaining({
        expectedCourseCode: 'MATH1014',
      })
    );
  });

  it('combines and sorts eClass and Cengage assignments when external lookup is forced', async () => {
    const course = nextCourse('combined');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([
      {
        id: 'eclass-late',
        name: 'Later eClass Homework',
        dueDate: '2026-04-25T12:00:00.000Z',
        status: 'Upcoming',
        courseId: course.id,
        courseName: course.name,
        courseCode: course.courseCode,
        url: 'https://eclass.yorku.ca/mod/assign/view.php?id=late',
      },
    ] as any);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'state',
      metaPath: 'meta',
    });
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([
      {
        title: 'MATH 1014 O',
        courseKey: 'WA-production-combined',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-combined',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockResolvedValue(
      withContext([
        {
          id: 'wa-early',
          name: 'Earlier WebAssign Homework',
          dueDate: '2026-04-20T12:00:00.000Z',
          status: 'Pending',
          url: '/assignment/wa-early',
        } as any,
      ])
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({
        courseCode: 'MATH1014',
        includeExternal: 'always',
      })
    );

    expect(payload.status).toBe('ok');
    expect(payload.assignments).toHaveLength(2);
    expect(payload.assignments[0].name).toBe('Earlier WebAssign Homework');
    expect(payload.assignments[1].name).toBe('Later eClass Homework');
    expect(payload.sources.eclass.assignmentCount).toBe(1);
    expect(payload.sources.cengage.assignmentCount).toBe(1);
  });

  it('does not return Cengage rows from a different WebAssign course context', async () => {
    const course = nextCourse('context-mismatch');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([]);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'state',
      metaPath: 'meta',
    });
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([
      {
        title: 'MATH 1014 O',
        courseKey: 'WA-production-1607530',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(
      new CengageCourseActivationError(
        'WebAssign opened a different active course than the selected Cengage course.',
        {
          actualCourseTitle: 'PHYS 1800 Fall 2025 Final, Fall 2025',
          actualCurrentSelected: '1199639,1577413',
        }
      )
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('needs_course_activation');
    expect(payload.code).toBe('COURSE_CONTEXT_MISMATCH');
    expect(payload.assignments).toHaveLength(0);
    expect(payload.sources.cengage.status).toBe('needs_course_activation');
    expect(payload.message).toContain('different active course');
    expect(payload.retry.afterAuth).toBe(false);
    expect(payload.retry.reason).toBe('course_activation_required');
    const record = getCoursePlatformRecord({
      courseId: course.id,
      courseCode: course.courseCode,
    });
    expect(record?.platforms.cengage?.status).toBe('linked');
    expect(record?.platforms.cengage?.activation?.status).toBe('failed');
  });

  it('returns partial with eClass rows when forced Cengage auth times out', async () => {
    const course = nextCourse('partial-auth');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([
      {
        id: 'eclass-1',
        name: 'eClass Homework',
        dueDate: '2026-04-20T12:00:00.000Z',
        status: 'Upcoming',
        courseId: course.id,
        courseName: course.name,
        courseCode: course.courseCode,
        url: 'https://eclass.yorku.ca/mod/assign/view.php?id=1',
      },
    ] as any);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: false,
      reason: 'missing_state',
      statePath: 'state',
      metaPath: 'meta',
    });
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForCengageAuthSession').mockResolvedValue(false);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth-cengage'
    );

    const payload = parsePayload(
      await getAssignments({
        courseCode: 'MATH1014',
        includeExternal: 'always',
      })
    );

    expect(payload.status).toBe('partial');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.sources.cengage.status).toBe('auth_required');
  });

  it('persists explicit Cengage course selection from platformSelection', async () => {
    const course = nextCourse('selection');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([]);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'state',
      metaPath: 'meta',
    });
    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromSavedSession'
    ).mockResolvedValue([
      {
        title: 'MATH 1014 O',
        courseKey: 'WA-production-1',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1',
        platform: 'webassign',
        confidence: 0.95,
      },
      {
        title: 'MATH 1014 N',
        courseKey: 'WA-production-2',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-2',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(withContext([]));
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({
        courseCode: 'MATH1014',
        platformSelection: {
          cengage: { courseKey: 'WA-production-2' },
        },
      })
    );

    const record = getCoursePlatformRecord({
      courseId: course.id,
      courseCode: course.courseCode,
    });

    expect(payload.sources.cengage.selectedCourse.courseKey).toBe(
      'WA-production-2'
    );
    expect(record?.platforms.cengage?.status).toBe('linked');
    expect(record?.platforms.cengage?.selectedBy).toBe('user_selection');
  });

  it('respects includeExternal=never', async () => {
    const course = nextCourse('never');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockResolvedValue([]);
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'state',
      metaPath: 'meta',
    });
    const dashboardSpy = vi
      .spyOn(CengageScraper.prototype, 'listDashboardCoursesFromSavedSession')
      .mockResolvedValue([]);

    const payload = parsePayload(
      await getAssignments({
        courseCode: 'MATH1014',
        includeExternal: 'never',
      })
    );

    expect(payload.status).toBe('no_data');
    expect(payload.sources.cengage.status).toBe('not_checked');
    expect(dashboardSpy).not.toHaveBeenCalled();
  });
});
