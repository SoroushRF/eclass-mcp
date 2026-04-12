import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { CengageScraper } from '../src/scraper/cengage';
import {
  CengageAuthRequiredError,
  CengageParseError,
} from '../src/scraper/cengage-errors';
import { getCengageAssignmentDetails } from '../src/tools/cengage';

const SAMPLE_COURSE = {
  courseId: 'math-1010',
  courseKey: 'WA-production-1001',
  title: 'MATH 1010 - Calculus I',
  launchUrl:
    'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
  platform: 'webassign' as const,
  confidence: 0.95,
};

function uniqueEntryUrl(tag: string): string {
  return `https://www.cengage.com/dashboard/home?details=${tag}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('get cengage assignment details tool', () => {
  it('returns question-level details for a selected assignment', async () => {
    const entryUrl = uniqueEntryUrl('ok');

    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);

    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentDetails'
    ).mockResolvedValue({
      selectedAssignment: {
        assignmentId: '39248944',
        name: 'Assignment 1',
        dueDate: 'Friday Jan 23 (11:59PM)',
        dueDateIso: '2026-01-23T23:59:00',
        status: 'graded',
        score: '20/20',
        url: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=39248944',
      },
      availableAssignments: [
        {
          assignmentId: '39248944',
          name: 'Assignment 1',
          dueDate: 'Friday Jan 23 (11:59PM)',
          dueDateIso: '2026-01-23T23:59:00',
          status: 'graded',
          score: '20/20',
          url: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=39248944',
        },
      ],
      details: {
        pageTitle: 'Assignment 1 - MATH 1010',
        heading: 'Assignment 1, Due Date: Friday Jan 23 (11:59PM) (Quiz)',
        questionCount: 2,
        returnedQuestionCount: 2,
        renderedMediaSummary: {
          processedQuestionCount: 2,
          renderedImageCount: 1,
          skippedImageCount: 0,
          maxRenderedImages: 20,
          maxCaptureUnits: 50,
          maxPayloadBytes: 800 * 1024,
          captureDpi: 100,
          minTextForSafeText: 250,
        },
        questions: [
          {
            questionNumber: 1,
            questionId: '4703112',
            prompt: "If f(x) = integral ... find g''(pi/6).",
            promptSections: [
              {
                title: 'Part 1 of 2',
                text: 'If f(x) = integral ...',
              },
              {
                title: 'Part 2 of 2',
                text: "Find g''(pi/6).",
              },
            ],
            hasMediaCarriers: true,
            mediaClassification: 'image',
            renderedMedia: [
              {
                kind: 'question_region_png',
                mimeType: 'image/png',
                data: 'aW1hZ2UtZGF0YQ==',
                byteSize: 10,
                captureDpi: 100,
              },
            ],
            pointsEarned: 1,
            pointsPossible: 1,
            submissionsUsed: '1/3',
            result: 'correct',
            feedback: 'Good job!',
          },
          {
            questionNumber: 2,
            questionId: '4710174',
            prompt: 'Evaluate the derivative at x = 3.',
            pointsEarned: 1,
            pointsPossible: 1,
            submissionsUsed: '1/3',
            result: 'correct',
          },
        ],
      },
    });

    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignmentDetails({
      entryUrl,
      assignmentQuery: 'Assignment 1',
      maxQuestions: 10,
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ok');
    expect(payload.selectedCourse.title).toBe(SAMPLE_COURSE.title);
    expect(payload.selectedAssignment.name).toBe('Assignment 1');
    expect(payload.details.questionCount).toBe(2);
    expect(payload.details.questions).toHaveLength(2);
    expect(payload.details.questions[0].result).toBe('correct');
    expect(payload.details.questions[0].promptSections).toHaveLength(2);
    expect(payload.details.questions[0].mediaClassification).toBe('image');
    expect(payload.details.questions[0].renderedMedia).toHaveLength(1);
    expect(payload.details.renderedMediaSummary.renderedImageCount).toBe(1);
    expect(payload.details.questions[0].promptSections[0].title).toBe(
      'Part 1 of 2'
    );
    expect(payload._cache.hit).toBe(false);
  });

  it('maps parse selection failures to no_data with available assignment choices', async () => {
    const entryUrl = uniqueEntryUrl('no-match');

    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockResolvedValue([SAMPLE_COURSE]);

    vi.spyOn(
      CengageScraper.prototype,
      'getAssignmentDetails'
    ).mockRejectedValue(
      new CengageParseError('No assignment matched assignmentQuery.', {
        availableAssignments: [
          {
            assignmentId: '39248944',
            name: 'Assignment 1',
            dueDate: 'Friday Jan 23 (11:59PM)',
            status: 'Pending',
            url: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=39248944',
          },
        ],
      })
    );

    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignmentDetails({
      entryUrl,
      assignmentQuery: 'Missing Assignment',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('no_data');
    expect(payload.availableAssignments).toHaveLength(1);
    expect(payload.availableAssignments[0].name).toBe('Assignment 1');
    expect(payload.availableAssignments[0].status).toBe('pending');
    expect(payload.message).toContain('No assignment matched');
  });

  it('maps auth-required errors to auth_required and opens cengage auth', async () => {
    const entryUrl = uniqueEntryUrl('auth');

    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => {});

    vi.spyOn(
      CengageScraper.prototype,
      'listDashboardCoursesFromEntryLink'
    ).mockRejectedValue(new CengageAuthRequiredError('Auth required'));

    vi.spyOn(CengageScraper.prototype, 'close').mockResolvedValue(undefined);

    const result = await getCengageAssignmentDetails({
      entryUrl,
      assignmentQuery: 'Assignment 1',
    });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('auth_required');
    expect(payload.retry.afterAuth).toBe(true);
    expect(payload.retry.authUrl).toContain('/auth-cengage');
    expect(payload.retry.input.entryUrl).toBe(entryUrl);
    expect(openAuthSpy).toHaveBeenCalledWith('cengage');
  });
});
