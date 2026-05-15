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
import {
  CengageAuthRequiredError,
  CengageCourseActivationError,
  CengageError,
} from '../src/scraper/cengage-errors';
import * as cengageSession from '../src/scraper/cengage-session';
import { scraper, SessionExpiredError } from '../src/scraper/eclass';
import { ScrapeLayoutError } from '../src/scraper/scrape-errors';
import { ValidationError } from '../src/errors/validation-error';
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

  it('maps eClass layout drift to SCRAPE_LAYOUT_CHANGED', async () => {
    const course = nextCourse('layout-drift');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockRejectedValue(
      new ScrapeLayoutError('Dashboard assignment layout changed', {
        groupId: 'eclass.calendar.upcoming_events',
        triedSelectors: ['.event'],
      })
    );

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('error');
    expect(payload.code).toBe('SCRAPE_LAYOUT_CHANGED');
    expect(payload.message).toContain('Dashboard assignment layout changed');
    expect(payload.assignments).toEqual([]);
  });

  it('maps eClass validation failures to VALIDATION_FAILED', async () => {
    const course = nextCourse('validation');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockRejectedValue(
      new ValidationError('Invalid date boundary', { field: 'from' })
    );

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('error');
    expect(payload.code).toBe('VALIDATION_FAILED');
    expect(payload.message).toContain('Invalid date boundary');
  });

  it('returns partial when Cengage fails after eClass rows were collected', async () => {
    const course = nextCourse('cengage-partial-error');
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
        courseKey: 'WA-production-partial-error',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-partial-error',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(
      new CengageError('parse_failed', 'Could not parse WebAssign rows')
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({
        courseCode: 'MATH1014',
        includeExternal: 'always',
      })
    );

    expect(payload.status).toBe('partial');
    expect(payload.assignments).toHaveLength(1);
    expect(payload.sources.cengage.status).toBe('error');
    expect(payload.message).toContain('parse_failed');
  });

  it('returns error when Cengage fails and no eClass rows exist', async () => {
    const course = nextCourse('cengage-empty-error');
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
        courseKey: 'WA-production-empty-error',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-empty-error',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(
      new CengageError('navigation_failed', 'WebAssign navigation failed')
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('error');
    expect(payload.assignments).toEqual([]);
    expect(payload.sources.cengage.status).toBe('error');
    expect(payload.message).toContain('navigation_failed');
  });

  it('does not treat generic Cengage errors as activation mismatches without diagnostics', async () => {
    const course = nextCourse('generic-context-mismatch');
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
        courseKey: 'WA-production-context',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-context',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(
      new CengageError(
        'course_context_mismatch',
        'WebAssign active course did not match'
      )
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);
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
    expect(payload.sources.cengage.status).toBe('error');
    expect(payload.retry).toBeUndefined();
    expect(payload.nextActions).toBeUndefined();
    expect(payload.message).toContain('course_context_mismatch');
  });

  it('preserves failed activation diagnostics when a linked course later verifies', async () => {
    const course = nextCourse('activation-verified');
    invalidateCourseCaches(course.id);
    upsertCoursePlatformMapping({
      eclass: {
        courseId: course.id,
        courseCode: course.courseCode,
        courseName: course.name,
      },
      cengage: {
        status: 'linked',
        courseKey: 'WA-production-verified',
        title: 'MATH 1014 O',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-verified',
        platform: 'webassign',
        selectedBy: 'user_selection',
        activation: {
          status: 'failed',
          failedAt: '2026-05-01T00:00:00.000Z',
          actualCourseTitle: 'PHYS 1800',
        },
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
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockResolvedValue(
      withContext([
        {
          id: 'verified-1',
          name: 'Verified WebAssign Homework',
          dueDate: '2026-04-22 23:59',
          status: 'Pending',
          url: '/assignment/verified-1',
        } as any,
      ])
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );
    const record = getCoursePlatformRecord({
      courseId: course.id,
      courseCode: course.courseCode,
    });

    expect(payload.status).toBe('ok');
    expect(record?.platforms.cengage?.activation?.status).toBe('verified');
    expect(record?.platforms.cengage?.activation?.actualCourseTitle).toBe(
      'PHYS 1800'
    );
    expect(record?.platforms.cengage?.assignmentsLastSeenAt).toBeTruthy();
  });

  it('stringifies unknown thrown values into stable error responses', async () => {
    const course = nextCourse('unknown-throw');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockRejectedValue('string failure');

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('error');
    expect(payload.message).toBe('string failure');
  });

  it('opens eClass auth, retries once, and returns assignments after a fresh session is saved', async () => {
    const course = nextCourse('eclass-retry-success');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    const deadlinesSpy = vi
      .spyOn(scraper, 'getDeadlines')
      .mockRejectedValueOnce(new SessionExpiredError('eClass session expired'))
      .mockResolvedValueOnce([
        {
          id: 'eclass-retry-1',
          name: 'Recovered eClass Deadline',
          dueDate: '2026-04-20T12:00:00.000Z',
          status: 'Upcoming',
          courseId: course.id,
          courseName: course.name,
          courseCode: course.courseCode,
          url: 'https://eclass.yorku.ca/mod/assign/view.php?id=retry',
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
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(true);

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('ok');
    expect(payload.assignments[0].name).toBe('Recovered eClass Deadline');
    expect(payload.sources.eclass.status).toBe('ok');
    expect(deadlinesSpy).toHaveBeenCalledTimes(2);
    expect(openAuthSpy).toHaveBeenCalledWith('eclass');
  });

  it('returns an actionable eClass retry payload when session refresh does not complete', async () => {
    const course = nextCourse('eclass-retry-timeout');
    invalidateCourseCaches(course.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([course]);
    vi.spyOn(scraper, 'getDeadlines').mockRejectedValue(
      new SessionExpiredError('eClass session expired')
    );
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(false);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );

    const payload = parsePayload(
      await getAssignments({ courseCode: 'MATH1014' })
    );

    expect(payload.status).toBe('needs_external_auth');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry).toEqual(
      expect.objectContaining({
        afterAuth: true,
        authUrl: 'http://localhost:3000/auth',
      })
    );
    expect(payload.retry.input).toMatchObject({ courseCode: 'MATH1014' });
  });

  it('opens Cengage auth, retries once, and returns WebAssign assignments after auth succeeds', async () => {
    const course = nextCourse('cengage-retry-success');
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
        courseKey: 'WA-production-retry',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-retry',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockRejectedValueOnce(
        new CengageAuthRequiredError('Cengage session expired', {
          reason: 'expired',
        })
      )
      .mockResolvedValueOnce(
        withContext([
          {
            id: 'wa-retry-1',
            name: 'Recovered WebAssign Homework',
            dueDate: '2026-04-22 23:59',
            status: 'Pending',
            url: '/assignment/retry',
          } as any,
        ])
      );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForCengageAuthSession').mockResolvedValue(true);

    const payload = parsePayload(
      await getAssignments({
        courseCode: 'MATH1014',
        includeExternal: 'always',
      })
    );

    expect(payload.status).toBe('ok');
    expect(payload.assignments[0]).toEqual(
      expect.objectContaining({
        name: 'Recovered WebAssign Homework',
        platform: 'webassign',
      })
    );
    expect(payload.sources.cengage.status).toBe('ok');
    expect(assignmentsSpy).toHaveBeenCalledTimes(2);
    expect(openAuthSpy).toHaveBeenCalledWith('cengage');
  });

  it('records Cengage auth_required when a saved session expires and browser auth is not completed', async () => {
    const course = nextCourse('cengage-retry-timeout');
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
        courseKey: 'WA-production-expired',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-expired',
        platform: 'webassign',
        confidence: 0.95,
      },
    ]);
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockRejectedValue(
      new CengageAuthRequiredError('Cengage session expired')
    );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);
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
    const record = getCoursePlatformRecord({
      courseId: course.id,
      courseCode: course.courseCode,
    });

    expect(payload.status).toBe('needs_external_auth');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.sources.cengage.status).toBe('auth_required');
    expect(payload.retry).toEqual(
      expect.objectContaining({
        afterAuth: true,
        authUrl: 'http://localhost:3000/auth-cengage',
      })
    );
    expect(record?.platforms.cengage?.status).toBe('auth_required');
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
    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentsForDashboardCourse'
    ).mockResolvedValue(withContext([]));
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

  it('aggregates all-course Cengage assignments while skipping unsupported dashboard platforms', async () => {
    const courseA = nextCourse('all-a');
    const courseB = nextCourse('all-b');
    invalidateCourseCaches(courseA.id);
    invalidateCourseCaches(courseB.id);

    vi.spyOn(scraper, 'getCourses').mockResolvedValue([courseA, courseB]);
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
        courseKey: 'WA-production-all',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-all',
        platform: 'webassign',
        confidence: 0.95,
      },
      {
        title: 'CHEM 1100 OWLv2',
        courseKey: 'E-OWL-ALL',
        launchUrl:
          'https://prod01-cnow-owl.cengagenow.com/ilrn/authentication.do?courseKey=E-OWL-ALL',
        platform: 'owlv2',
        assignmentsSupported: false,
        confidence: 0.9,
      },
    ]);
    const assignmentsSpy = vi
      .spyOn(CengageScraper.prototype, 'getAssignmentsForDashboardCourse')
      .mockResolvedValue(
        withContext([
          {
            id: 'all-wa-1',
            name: 'All Courses WebAssign Homework',
            dueDate: '2026-04-24 23:59',
            status: 'Pending',
            url: '/assignment/all-wa-1',
          } as any,
        ])
      );
    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const payload = parsePayload(
      await getAssignments({ includeExternal: 'always' })
    );

    expect(payload.status).toBe('ok');
    expect(payload.course).toBeUndefined();
    expect(payload.sources.cengage).toEqual(
      expect.objectContaining({
        checked: true,
        status: 'ok',
        assignmentCount: 1,
      })
    );
    expect(payload.assignments).toEqual([
      expect.objectContaining({
        name: 'All Courses WebAssign Homework',
        platform: 'webassign',
      }),
    ]);
    expect(assignmentsSpy).toHaveBeenCalledTimes(1);
    expect(assignmentsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'webassign' }),
      expect.any(Object)
    );
  });
});
