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
import { clearCache } from '../src/tools/cache';
import {
  getCoursePlatformIndexPath,
  getCoursePlatformRecord,
  invalidateCoursePlatformIndexMemoryCache,
  loadCoursePlatformIndex,
  recordCengageAmbiguous,
  recordCengageAuthRequired,
  recordCengageNotFound,
  saveCoursePlatformIndex,
  upsertCoursePlatformMapping,
} from '../src/tools/assignments/platform-index';

const indexPath = getCoursePlatformIndexPath();
let originalIndexContent: string | null = null;

function cleanupIndexArtifacts(): void {
  invalidateCoursePlatformIndexMemoryCache();
  if (fs.existsSync(indexPath)) {
    fs.unlinkSync(indexPath);
  }
  const dir = path.dirname(indexPath);
  if (fs.existsSync(dir)) {
    const prefix = `${path.basename(indexPath)}.${process.pid}.`;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(prefix) && entry.endsWith('.tmp')) {
        fs.unlinkSync(path.join(dir, entry));
      }
    }
  }
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

describe('course platform index storage', () => {
  it('loads empty state for missing and malformed files', () => {
    expect(loadCoursePlatformIndex().records).toEqual({});

    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, '{bad-json', 'utf-8');
    invalidateCoursePlatformIndexMemoryCache();

    expect(loadCoursePlatformIndex().records).toEqual({});
  });

  it('upserts and reads a linked Cengage mapping', () => {
    const record = upsertCoursePlatformMapping({
      eclass: {
        courseId: '101',
        courseCode: 'MATH1014',
        courseName: 'MATH 1014 O',
      },
      cengage: {
        status: 'linked',
        courseKey: 'WA-production-1607530',
        title: 'MATH 1014 O',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
        platform: 'webassign',
        selectedBy: 'auto_match',
      },
    });

    invalidateCoursePlatformIndexMemoryCache();
    const loaded = getCoursePlatformRecord({
      courseId: '101',
      courseCode: 'MATH1014',
    });

    expect(record.recordId).toBe('eclass:101');
    expect(loaded?.platforms.cengage?.status).toBe('linked');
    expect(loaded?.platforms.cengage?.courseKey).toBe('WA-production-1607530');
  });

  it('persists activation diagnostics for linked mappings', () => {
    upsertCoursePlatformMapping({
      eclass: {
        courseId: '101',
        courseCode: 'MATH1014',
        courseName: 'MATH 1014 O',
      },
      cengage: {
        status: 'linked',
        courseKey: 'WA-production-1607530',
        title: 'MATH 1014 O',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
        platform: 'webassign',
        selectedBy: 'auto_match',
        activation: {
          status: 'failed',
          failedAt: '2026-05-08T00:00:00.000Z',
          actualCourseTitle: 'PHYS 1800 Fall 2025 Final',
          actualCurrentSelected: '1199639,1577413',
          expectedCourseKey: 'WA-production-1607530',
          lastErrorCode: 'COURSE_CONTEXT_MISMATCH',
        },
      },
    });

    invalidateCoursePlatformIndexMemoryCache();
    let loaded = getCoursePlatformRecord({
      courseId: '101',
      courseCode: 'MATH1014',
    });
    expect(loaded?.platforms.cengage?.status).toBe('linked');
    expect(loaded?.platforms.cengage?.activation?.status).toBe('failed');
    expect(loaded?.platforms.cengage?.activation?.actualCourseTitle).toContain(
      'PHYS 1800'
    );

    upsertCoursePlatformMapping({
      eclass: {
        courseId: '101',
        courseCode: 'MATH1014',
        courseName: 'MATH 1014 O',
      },
      cengage: {
        ...loaded!.platforms.cengage!,
        activation: {
          status: 'verified',
          verifiedAt: '2026-05-08T00:10:00.000Z',
          expectedCourseKey: 'WA-production-1607530',
        },
      },
    });

    invalidateCoursePlatformIndexMemoryCache();
    loaded = getCoursePlatformRecord({
      courseId: '101',
      courseCode: 'MATH1014',
    });
    expect(loaded?.platforms.cengage?.activation?.status).toBe('verified');
    expect(loaded?.platforms.cengage?.activation?.verifiedAt).toBe(
      '2026-05-08T00:10:00.000Z'
    );
  });

  it('retries replacing the index when Windows blocks the first rename', () => {
    saveCoursePlatformIndex({
      version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      records: {},
    });

    const realRenameSync = fs.renameSync;
    const renameSpy = vi
      .spyOn(fs, 'renameSync')
      .mockImplementationOnce(() => {
        const error = new Error('EPERM: operation not permitted, rename');
        (error as NodeJS.ErrnoException).code = 'EPERM';
        throw error;
      })
      .mockImplementation((oldPath, newPath) =>
        realRenameSync(oldPath, newPath)
      );

    saveCoursePlatformIndex({
      version: 1,
      updated_at: '2026-01-02T00:00:00.000Z',
      records: {
        'eclass:101': {
          recordId: 'eclass:101',
          eclass: {
            courseId: '101',
            courseCode: 'MATH1014',
          },
          platforms: {
            cengage: {
              status: 'linked',
              courseKey: 'WA-production-1607530',
              selectedBy: 'auto_match',
            },
          },
        },
      },
    });

    expect(renameSpy).toHaveBeenCalledTimes(2);
    invalidateCoursePlatformIndexMemoryCache();
    expect(
      getCoursePlatformRecord({ courseId: '101', courseCode: 'MATH1014' })
        ?.platforms.cengage?.courseKey
    ).toBe('WA-production-1607530');
  });

  it('cleans the temp file and preserves non-transient rename errors', () => {
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      const error = new Error('ENOSPC: no space left on device');
      (error as NodeJS.ErrnoException).code = 'ENOSPC';
      throw error;
    });

    expect(() =>
      saveCoursePlatformIndex({
        version: 1,
        updated_at: '2026-01-01T00:00:00.000Z',
        records: {},
      })
    ).toThrow('ENOSPC');

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const leftovers = fs
      .readdirSync(path.dirname(indexPath))
      .filter(
        (entry) =>
          entry.startsWith(`${path.basename(indexPath)}.${process.pid}.`) &&
          entry.endsWith('.tmp')
      );
    expect(leftovers).toEqual([]);
  });

  it('migrates stale record ids when a stronger eClass course id is known', () => {
    saveCoursePlatformIndex({
      version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      records: {
        'eclass:t41-never-1777872239221-9': {
          recordId: 'eclass:t41-never-1777872239221-9',
          eclass: {
            courseCode: 'MATH1014',
            courseName: 'MATH 1014 O',
          },
          platforms: {
            cengage: {
              status: 'linked',
              courseKey: 'WA-production-1607530',
              title: 'MATH 1014 O',
              launchUrl:
                'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
              platform: 'webassign',
              selectedBy: 'user_selection',
            },
          },
        },
      },
    });

    const migrated = upsertCoursePlatformMapping({
      eclass: {
        courseId: '143648',
        courseCode: 'MATH1014',
        courseName: 'SC/MATH 1014 O - Applied Calculus II',
      },
      cengage: {
        status: 'linked',
        courseKey: 'WA-production-1607530',
        title: 'MATH 1014 O',
        launchUrl:
          'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
        platform: 'webassign',
        selectedBy: 'user_selection',
      },
    });

    const loaded = loadCoursePlatformIndex();
    expect(migrated.recordId).toBe('eclass:143648');
    expect(loaded.records['eclass:143648']).toBeDefined();
    expect(loaded.records['eclass:t41-never-1777872239221-9']).toBeUndefined();
  });

  it('finds stale records by normalized course code when course id is unavailable', () => {
    saveCoursePlatformIndex({
      version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      records: {
        'name:math_1014_o': {
          recordId: 'name:math_1014_o',
          eclass: {
            courseCode: 'MATH 1014 O',
            courseName: 'SC/MATH 1014 O - Applied Calculus II',
          },
          platforms: {
            cengage: {
              status: 'linked',
              courseKey: 'WA-production-code-match',
              selectedBy: 'auto_match',
            },
          },
        },
      },
    });

    invalidateCoursePlatformIndexMemoryCache();
    const record = getCoursePlatformRecord({ courseCode: 'math-1014-o' });

    expect(record?.recordId).toBe('name:math_1014_o');
    expect(record?.platforms.cengage?.courseKey).toBe(
      'WA-production-code-match'
    );
  });

  it('persists helper statuses for not_found, ambiguous, and auth_required mappings', () => {
    const eclass = {
      courseId: '101',
      courseCode: 'MATH1014',
      courseName: 'MATH 1014 O',
    };

    expect(
      recordCengageNotFound(eclass, { reason: 'no dashboard match' }).platforms
        .cengage?.status
    ).toBe('not_found');
    expect(
      getCoursePlatformRecord(eclass)?.platforms.cengage?.diagnostics
    ).toEqual({ reason: 'no dashboard match' });

    expect(
      recordCengageAmbiguous(eclass, [
        {
          title: 'MATH 1014 O',
          launchUrl: 'https://www.webassign.net/v4cgi/login.pl?courseKey=one',
          courseKey: 'one',
        },
      ]).platforms.cengage?.status
    ).toBe('ambiguous');
    expect(
      getCoursePlatformRecord(eclass)?.platforms.cengage?.candidates
    ).toHaveLength(1);

    expect(recordCengageAuthRequired(eclass).platforms.cengage?.status).toBe(
      'auth_required'
    );
    expect(getCoursePlatformRecord(eclass)?.platforms.cengage?.selectedBy).toBe(
      'auto_match'
    );
  });

  it('uses tmp file plus rename when saving', () => {
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      return undefined;
    });

    saveCoursePlatformIndex({
      version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      records: {},
    });

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [tmpPath, targetPath] = renameSpy.mock.calls[0];
    expect(targetPath).toBe(indexPath);
    expect(String(tmpPath)).toMatch(
      new RegExp(
        `${indexPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.${process.pid}\\.\\d+\\.[a-z0-9]+\\.tmp$`
      )
    );
  });

  it('is not removed by clear_cache(all)', async () => {
    upsertCoursePlatformMapping({
      eclass: {
        courseId: '101',
        courseCode: 'MATH1014',
      },
      cengage: {
        status: 'not_found',
        selectedBy: 'auto_match',
      },
    });

    expect(fs.existsSync(indexPath)).toBe(true);
    await clearCache('all');
    expect(fs.existsSync(indexPath)).toBe(true);
  });
});
