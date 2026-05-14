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
  const tmpPath = `${indexPath}.${process.pid}.tmp`;
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
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
    expect(loaded?.platforms.cengage?.courseKey).toBe(
      'WA-production-1607530'
    );
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

  it('uses tmp file plus rename when saving', () => {
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      return undefined;
    });

    saveCoursePlatformIndex({
      version: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      records: {},
    });

    expect(renameSpy).toHaveBeenCalledWith(
      `${indexPath}.${process.pid}.tmp`,
      indexPath
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
