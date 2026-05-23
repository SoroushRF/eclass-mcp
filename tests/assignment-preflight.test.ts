import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CengageCourseActivationError } from '../src/scraper/cengage-errors';
import { prepareAssignmentSubmission } from '../src/tools/assignment-preflight';
import { summarizeIntendedFiles } from '../src/tools/assignment-preflight-files';
import type {
  CengageScraperDependency,
  EclassScraperDependency,
  ToolDependencies,
} from '../src/tools/dependencies';
import { verifyPreflightRef } from '../src/tools/write-preflight-ref';

const originalSessionSecret = process.env.ECLASS_MCP_SESSION_SECRET;
const tempDirs = new Set<string>();

function setSecret() {
  process.env.ECLASS_MCP_SESSION_SECRET = 't37-test-secret'.repeat(3);
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'eclass-t37-'));
  tempDirs.add(dir);
  return dir;
}

function parsePayload(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0].text || '{}') as Record<string, unknown>;
}

function createDeps(options?: {
  preflight?: Partial<
    Awaited<
      ReturnType<EclassScraperDependency['getAssignmentSubmissionPreflight']>
    >
  >;
  cengageAssignments?: Array<Record<string, unknown>>;
  cengageActivationFailure?: boolean;
}): ToolDependencies {
  const eclassScraper = {
    getCourses: vi.fn(async () => [
      {
        id: 'course-1',
        name: 'Software Design',
        courseCode: 'EECS1021',
        url: 'https://eclass.yorku.ca/course/view.php?id=course-1',
      },
      {
        id: 'course-2',
        name: 'Software Design Lab',
        courseCode: 'EECS1021L',
        url: 'https://eclass.yorku.ca/course/view.php?id=course-2',
      },
    ]),
    getCourseContent: vi.fn(async (courseId: string) => ({
      courseId,
      sections: [
        {
          title: 'Labs',
          items: [
            {
              type: 'assign' as const,
              name: 'Lab 5',
              url: 'https://eclass.yorku.ca/mod/assign/view.php?id=555',
            },
          ],
        },
      ],
    })),
    getDeadlines: vi.fn(async () => []),
    getAllAssignmentDeadlines: vi.fn(async () => []),
    getItemDetails: vi.fn(async (url: string) => ({
      kind: 'assign' as const,
      url,
      title: 'Lab 5',
    })),
    getAssignmentSubmissionPreflight: vi.fn(async (url: string) => ({
      kind: 'assign' as const,
      url,
      courseId: 'course-1',
      title: 'Lab 5',
      cmId: '555',
      dueDate: 'Friday, May 29, 2026, 11:59 PM',
      submissionState: 'Draft',
      isFinalized: false,
      canEditSubmission: true,
      canSubmitFinal: false,
      uploadSlots: [
        {
          kind: 'file' as const,
          label: 'File submissions',
          canUpload: true,
          maxFiles: 3,
          maxBytes: 10_000,
          accepts: ['.java'],
          currentFiles: [],
        },
      ],
      ...options?.preflight,
    })),
    downloadFile: vi.fn(async () => ({
      buffer: Buffer.from(''),
      mimeType: 'text/plain',
      filename: 'empty.txt',
    })),
    getSectionText: vi.fn(async (url: string) => ({
      url,
      title: 'Section',
      mainText: '',
      mainLinks: [],
      tabs: [],
    })),
    getGrades: vi.fn(async () => []),
    getAnnouncements: vi.fn(async () => []),
  } satisfies EclassScraperDependency;

  const cengageScraper = {
    listDashboardCoursesFromSavedSession: vi.fn(async () => [
      {
        courseId: 'wa-course-1',
        courseKey: 'WA-101',
        title: 'Calculus WebAssign',
        launchUrl:
          'https://www.webassign.net/web/Student/Assignment-Responses/course',
        platform: 'webassign' as const,
        assignmentsSupported: true,
        confidence: 1,
      },
    ]),
    listDashboardCoursesFromEntryLink: vi.fn(async () => [
      {
        courseId: 'wa-course-1',
        courseKey: 'WA-101',
        title: 'Calculus WebAssign',
        launchUrl:
          'https://www.webassign.net/web/Student/Assignment-Responses/course',
        platform: 'webassign' as const,
        assignmentsSupported: true,
        confidence: 1,
      },
    ]),
    getAssignmentsForDashboardCourse: vi.fn(async () => {
      if (options?.cengageActivationFailure) {
        throw new CengageCourseActivationError(
          'WebAssign opened a different active course than the selected Cengage course.',
          { actualCourseTitle: 'Wrong Course' }
        );
      }
      return {
        assignments: options?.cengageAssignments?.map((assignment) => ({
          id: String(assignment.id || assignment.assignmentId || 'wa-1'),
          name: String(assignment.name || 'Homework 1'),
          dueDate: String(assignment.dueDate || 'May 29, 2026'),
          dueDateIso: String(
            assignment.dueDateIso || '2026-05-29T23:59:00.000Z'
          ),
          status: String(assignment.status || 'Pending'),
          score:
            typeof assignment.score === 'string' ? assignment.score : undefined,
          courseId: 'wa-course-1',
          courseTitle: 'Calculus WebAssign',
          url: String(
            assignment.url ||
              'https://www.webassign.net/web/Student/Assignment-Responses/wa-1'
          ),
          rawText: 'Homework 1',
        })) || [
          {
            id: 'wa-1',
            name: 'Homework 1',
            dueDate: 'May 29, 2026',
            dueDateIso: '2026-05-29T23:59:00.000Z',
            status: 'Pending',
            score: undefined,
            courseId: 'wa-course-1',
            courseTitle: 'Calculus WebAssign',
            url: 'https://www.webassign.net/web/Student/Assignment-Responses/wa-1',
            rawText: 'Homework 1',
          },
        ],
      };
    }),
    close: vi.fn(async () => undefined),
  } as unknown as CengageScraperDependency;

  return {
    eclassScraper,
    createSisScraper: vi.fn(() => ({
      scrapeExams: vi.fn(async () => []),
      scrapeTimetable: vi.fn(async () => []),
    })),
    createRmpClient: vi.fn(() => ({
      searchTeachersWithDiagnostics: vi.fn(),
      getTeacherDetails: vi.fn(),
    })),
    createCengageScraper: vi.fn(() => cengageScraper),
  };
}

afterEach(async () => {
  if (originalSessionSecret === undefined) {
    delete process.env.ECLASS_MCP_SESSION_SECRET;
  } else {
    process.env.ECLASS_MCP_SESSION_SECRET = originalSessionSecret;
  }

  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
  vi.restoreAllMocks();
});

describe('intended upload file summaries', () => {
  it('summarizes readable local files with size, MIME guess, and SHA-256', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'Answer.java');
    await writeFile(filePath, 'class Answer {}', 'utf8');

    const result = await summarizeIntendedFiles([{ path: filePath }]);

    expect(result.blockers).toEqual([]);
    expect(result.summaries[0]).toMatchObject({
      name: 'Answer.java',
      path: filePath,
      sizeBytes: Buffer.byteLength('class Answer {}'),
      mimeType: 'text/x-java-source',
    });
    expect(result.summaries[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks directories and missing paths', async () => {
    const dir = await makeTempDir();
    const nestedDir = path.join(dir, 'folder');
    await mkdir(nestedDir);

    const result = await summarizeIntendedFiles([
      { path: nestedDir },
      { path: path.join(dir, 'missing.pdf') },
    ]);

    expect(result.summaries).toEqual([]);
    expect(result.blockers).toHaveLength(2);
  });
});

describe('prepare_assignment_submission tool', () => {
  it('returns signed eClass preflight for an exact assignment URL', async () => {
    setSecret();
    const payload = parsePayload(
      await prepareAssignmentSubmission(
        {
          assignmentUrl: 'https://eclass.yorku.ca/mod/assign/view.php?id=555',
        },
        createDeps()
      )
    );

    expect(payload).toMatchObject({
      status: 'ok',
      platform: 'eclass',
      writeSupport: 'supported',
      submissionMode: 'file_upload',
      assignment: expect.objectContaining({ title: 'Lab 5', cmId: '555' }),
    });
    expect(payload.targetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof payload.preflightRef).toBe('string');
    expect(verifyPreflightRef(String(payload.preflightRef)).targetHash).toBe(
      payload.targetHash
    );
  });

  it('returns ambiguous when course and assignment selectors are not specific enough', async () => {
    setSecret();
    const payload = parsePayload(
      await prepareAssignmentSubmission(
        {
          courseQuery: 'Software Design',
          assignmentQuery: 'Lab',
        },
        createDeps()
      )
    );

    expect(payload).toMatchObject({
      status: 'ambiguous',
      code: 'WRITE_TARGET_AMBIGUOUS',
      platform: 'eclass',
    });
    expect(payload.preflightRef).toBeUndefined();
  });

  it('blocks finalized eClass assignments', async () => {
    setSecret();
    const payload = parsePayload(
      await prepareAssignmentSubmission(
        {
          assignmentUrl: 'https://eclass.yorku.ca/mod/assign/view.php?id=555',
        },
        createDeps({
          preflight: {
            isFinalized: true,
            canEditSubmission: false,
            submissionState: 'Submitted for grading',
          },
        })
      )
    );

    expect(payload).toMatchObject({
      status: 'blocked',
      code: 'SUBMISSION_ALREADY_FINALIZED',
      platform: 'eclass',
    });
    expect(payload.preflightRef).toBeUndefined();
  });

  it('blocks intended files when no upload slot exists', async () => {
    setSecret();
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'answer.pdf');
    await writeFile(filePath, 'pdf-ish', 'utf8');

    const payload = parsePayload(
      await prepareAssignmentSubmission(
        {
          assignmentUrl: 'https://eclass.yorku.ca/mod/assign/view.php?id=555',
          intendedFiles: [{ path: filePath }],
        },
        createDeps({
          preflight: {
            uploadSlots: [],
            canEditSubmission: true,
          },
        })
      )
    );

    expect(payload).toMatchObject({
      status: 'blocked',
      code: 'UPLOAD_SLOT_NOT_FOUND',
      platform: 'eclass',
    });
    expect(payload.intendedFiles).toEqual([
      expect.objectContaining({
        name: 'answer.pdf',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it('returns signed Cengage/WebAssign preflight with unsupported write warning', async () => {
    setSecret();
    const payload = parsePayload(
      await prepareAssignmentSubmission(
        {
          platform: 'cengage',
          entryUrl: 'https://www.cengage.com/dashboard/home',
          courseQuery: 'Calculus',
          assignmentQuery: 'Homework 1',
        },
        createDeps()
      )
    );

    expect(payload).toMatchObject({
      status: 'ok',
      platform: 'cengage',
      writeSupport: 'unsupported_external_platform',
      submissionMode: 'external',
      assignment: expect.objectContaining({
        title: 'Homework 1',
        submissionState: 'pending',
      }),
    });
    expect(String(payload.warnings)).toContain('read-only');
    expect(verifyPreflightRef(String(payload.preflightRef)).targetHash).toBe(
      payload.targetHash
    );
  });

  it('preserves Cengage active-course mismatch as a blocker', async () => {
    setSecret();
    const payload = parsePayload(
      await prepareAssignmentSubmission(
        {
          platform: 'cengage',
          entryUrl: 'https://www.cengage.com/dashboard/home?mismatch=1',
          courseQuery: 'Calculus',
        },
        createDeps({ cengageActivationFailure: true })
      )
    );

    expect(payload).toMatchObject({
      status: 'blocked',
      code: 'COURSE_CONTEXT_MISMATCH',
      platform: 'cengage',
    });
    expect(payload.preflightRef).toBeUndefined();
  });
});
