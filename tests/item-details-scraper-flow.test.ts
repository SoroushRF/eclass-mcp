import { describe, expect, it, vi } from 'vitest';
import {
  getAssignmentDetails,
  getItemDetails,
  getQuizDetails,
} from '../src/scraper/eclass/item-details';

function createMockSession(options: {
  evaluateResult?: any;
  evaluateError?: Error;
  includeCommentLink?: boolean;
}) {
  const commentLinkClick = vi.fn().mockResolvedValue(undefined);

  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    $: vi
      .fn()
      .mockResolvedValue(
        options.includeCommentLink ? { click: commentLinkClick } : null
      ),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async () => {
      if (options.evaluateError) {
        throw options.evaluateError;
      }
      return options.evaluateResult;
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const session = {
    getAuthenticatedContext: vi.fn().mockResolvedValue(context),
  };

  return { session, context, page, commentLinkClick };
}

describe('item details scraper wrappers', () => {
  it('getAssignmentDetails maps evaluated payload and classifies external links', async () => {
    const assignmentUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=501';

    const { session, context, page, commentLinkClick } = createMockSession({
      includeCommentLink: true,
      evaluateResult: {
        kind: 'assign',
        url: assignmentUrl,
        title: 'Assignment 1',
        rawDescriptionLinks: [
          {
            name: 'Internal forum',
            url: 'https://eclass.yorku.ca/mod/forum/discuss.php?d=10',
          },
          {
            name: 'Launch WebAssign',
            url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-501',
          },
          {
            name: 'LTI launch',
            url: '/mod/lti/view.php?id=12345',
          },
        ],
      },
    });

    const result = await getAssignmentDetails(session as any, assignmentUrl);

    expect(result.kind).toBe('assign');
    expect(result.externalLinks).toEqual([
      {
        name: 'Launch WebAssign',
        url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-501',
        linkType: 'webassign_course',
      },
      {
        name: 'LTI launch',
        url: 'https://eclass.yorku.ca/mod/lti/view.php?id=12345',
        linkType: 'eclass_lti',
      },
    ]);

    expect(page.goto).toHaveBeenCalledWith(assignmentUrl, {
      waitUntil: 'load',
      timeout: 60000,
    });
    expect(commentLinkClick).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('getAssignmentDetails closes page/context when evaluation throws', async () => {
    const assignmentUrl = 'https://eclass.yorku.ca/mod/assign/view.php?id=700';
    const { session, context, page } = createMockSession({
      evaluateError: new Error('simulated evaluate failure'),
    });

    await expect(
      getAssignmentDetails(session as any, assignmentUrl)
    ).rejects.toThrow('simulated evaluate failure');

    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('getQuizDetails omits externalLinks when only internal non-LTI links exist', async () => {
    const quizUrl = 'https://eclass.yorku.ca/mod/quiz/view.php?id=900';
    const { session, context, page } = createMockSession({
      evaluateResult: {
        kind: 'quiz',
        url: quizUrl,
        title: 'Quiz 1',
        rawDescriptionLinks: [
          {
            name: 'Forum reference',
            url: 'https://eclass.yorku.ca/mod/forum/view.php?id=100',
          },
        ],
      },
    });

    const result = await getQuizDetails(session as any, quizUrl);

    expect(result.kind).toBe('quiz');
    expect(result.externalLinks).toBeUndefined();
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('getItemDetails dispatches by URL type (assign vs quiz)', async () => {
    const assignSession = createMockSession({
      evaluateResult: {
        kind: 'assign',
        url: 'https://eclass.yorku.ca/mod/assign/view.php?id=11',
        title: 'Assignment A',
        rawDescriptionLinks: [],
      },
    });

    const quizSession = createMockSession({
      evaluateResult: {
        kind: 'quiz',
        url: 'https://eclass.yorku.ca/mod/quiz/view.php?id=22',
        title: 'Quiz B',
        rawDescriptionLinks: [],
      },
    });

    const assignResult = await getItemDetails(
      assignSession.session as any,
      'https://eclass.yorku.ca/mod/assign/view.php?id=11'
    );
    const quizResult = await getItemDetails(
      quizSession.session as any,
      'https://eclass.yorku.ca/mod/quiz/view.php?id=22'
    );

    expect(assignResult.kind).toBe('assign');
    expect(quizResult.kind).toBe('quiz');
  });
});
