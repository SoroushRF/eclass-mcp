import type { Page } from 'playwright';

export type CengagePageState =
  | 'login'
  | 'dashboard'
  | 'course'
  | 'assignments'
  | 'unknown';

export interface CengagePageStateSignals {
  url: string;
  title?: string;
  bodyTextSnippet?: string;
  hasPasswordInput?: boolean;
  hasLoginButton?: boolean;
  hasAssignmentsWrapper?: boolean;
  hasDueDateText?: boolean;
  hasPastAssignmentsButton?: boolean;
  hasCourseLinks?: boolean;
}

export interface CengagePageStateResult {
  state: CengagePageState;
  reason: string;
  diagnostics: {
    url: string;
    title: string;
    markers: {
      hasPasswordInput: boolean;
      hasLoginButton: boolean;
      hasAssignmentsWrapper: boolean;
      hasDueDateText: boolean;
      hasPastAssignmentsButton: boolean;
      hasCourseLinks: boolean;
      hasWebassignStudentUrl: boolean;
      hasWebassignLoginWithCourseKey: boolean;
      hasGetEnrolledCourseKey: boolean;
      hasDashboardUrl: boolean;
      hasLoginUrl: boolean;
    };
  };
}

function normalizeSignals(signals: CengagePageStateSignals) {
  const url = (signals.url || '').trim();
  const title = (signals.title || '').trim();
  const bodyText = (signals.bodyTextSnippet || '').trim();

  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const lowerBody = bodyText.toLowerCase();

  const hasWebassignStudentUrl =
    lowerUrl.includes('webassign.net/web/student') ||
    lowerUrl.includes('webassign.net/v4cgi/student');

  const hasWebassignLogin = lowerUrl.includes('webassign.net/v4cgi/login.pl');
  const hasCourseKeyInUrl = lowerUrl.includes('coursekey=');
  const hasWebassignLoginWithCourseKey = hasWebassignLogin && hasCourseKeyInUrl;
  const hasGetEnrolledCourseKey =
    lowerUrl.includes('getenrolled.com') && hasCourseKeyInUrl;

  const hasLoginUrl =
    lowerUrl.includes('login.cengage.com') ||
    lowerUrl.includes('/login') ||
    lowerUrl.includes('/signin') ||
    lowerUrl.includes('/auth');

  const hasCengageHost =
    lowerUrl.includes('cengage.com') || lowerUrl.includes('cengage.ca');
  const hasCengageDashboardPath = lowerUrl.includes('/dashboard/');

  const hasDashboardUrl =
    (hasCengageHost && hasCengageDashboardPath) ||
    lowerUrl.includes('/mindtap') ||
    lowerUrl.includes('/nglms');

  const hasPasswordInput = !!signals.hasPasswordInput;
  const hasLoginButton = !!signals.hasLoginButton;
  const hasAssignmentsWrapper = !!signals.hasAssignmentsWrapper;
  const hasDueDateText =
    !!signals.hasDueDateText || lowerBody.includes('due date');
  const hasPastAssignmentsButton =
    !!signals.hasPastAssignmentsButton ||
    lowerBody.includes('past assignments');
  const hasCourseLinks =
    !!signals.hasCourseLinks ||
    lowerBody.includes('my courses') ||
    lowerTitle.includes('dashboard');

  return {
    url,
    title,
    hasPasswordInput,
    hasLoginButton,
    hasAssignmentsWrapper,
    hasDueDateText,
    hasPastAssignmentsButton,
    hasCourseLinks,
    hasWebassignStudentUrl,
    hasWebassignLoginWithCourseKey,
    hasGetEnrolledCourseKey,
    hasDashboardUrl,
    hasLoginUrl,
  };
}

export function classifyCengagePageState(
  signals: CengagePageStateSignals
): CengagePageStateResult {
  const normalized = normalizeSignals(signals);

  const assignmentMarkers =
    normalized.hasAssignmentsWrapper ||
    normalized.hasDueDateText ||
    normalized.hasPastAssignmentsButton;

  if (normalized.hasWebassignStudentUrl && assignmentMarkers) {
    return {
      state: 'assignments',
      reason: 'Detected WebAssign student page with assignment indicators.',
      diagnostics: {
        url: normalized.url,
        title: normalized.title,
        markers: {
          ...normalized,
        },
      },
    };
  }

  if (
    normalized.hasWebassignStudentUrl ||
    normalized.hasWebassignLoginWithCourseKey ||
    normalized.hasGetEnrolledCourseKey
  ) {
    return {
      state: 'course',
      reason: 'Detected WebAssign course/student context.',
      diagnostics: {
        url: normalized.url,
        title: normalized.title,
        markers: {
          ...normalized,
        },
      },
    };
  }

  if (
    normalized.hasLoginUrl ||
    normalized.hasPasswordInput ||
    normalized.hasLoginButton
  ) {
    return {
      state: 'login',
      reason: 'Detected login URL or login form controls.',
      diagnostics: {
        url: normalized.url,
        title: normalized.title,
        markers: {
          ...normalized,
        },
      },
    };
  }

  if (normalized.hasDashboardUrl || normalized.hasCourseLinks) {
    return {
      state: 'dashboard',
      reason: 'Detected dashboard-style URL or course list markers.',
      diagnostics: {
        url: normalized.url,
        title: normalized.title,
        markers: {
          ...normalized,
        },
      },
    };
  }

  return {
    state: 'unknown',
    reason: 'No known Cengage/WebAssign state markers were detected.',
    diagnostics: {
      url: normalized.url,
      title: normalized.title,
      markers: {
        ...normalized,
      },
    },
  };
}

async function collectCengagePageStateSignals(
  page: Page
): Promise<CengagePageStateSignals> {
  const snapshot = await page.evaluate(() => {
    const bodyText = document.body?.innerText || '';

    const hasLoginButton = Array.from(
      document.querySelectorAll('button, input[type="submit"]')
    ).some((el) => {
      const text = (el as HTMLInputElement).value || el.textContent || '';
      return /sign in|log in|continue/i.test(text);
    });

    const hasPastAssignmentsButton = Array.from(
      document.querySelectorAll('button, a')
    ).some((el) => /past assignments/i.test(el.textContent || ''));

    const hasCourseLinks =
      document.querySelectorAll('a[href*="courseKey="]').length > 0 ||
      document.querySelectorAll('a[href*="webassign"]').length > 1;

    return {
      title: document.title || '',
      bodyTextSnippet: bodyText.slice(0, 2000),
      hasPasswordInput: !!document.querySelector('input[type="password"]'),
      hasLoginButton,
      hasAssignmentsWrapper: !!document.querySelector(
        '#js-student-myAssignmentsWrapper'
      ),
      hasDueDateText: /due date/i.test(bodyText),
      hasPastAssignmentsButton,
      hasCourseLinks,
    };
  });

  return {
    url: page.url(),
    ...snapshot,
  };
}

function isTransientNavigationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('execution context was destroyed') ||
    message.includes('most likely because of a navigation') ||
    message.includes('cannot find context with specified id') ||
    message.includes('frame was detached')
  );
}

export async function detectCengagePageState(
  page: Page
): Promise<CengagePageStateResult> {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const signals = await collectCengagePageStateSignals(page);
      return classifyCengagePageState(signals);
    } catch (error) {
      if (!isTransientNavigationError(error) || attempt === maxAttempts) {
        throw error;
      }

      await page
        .waitForLoadState('domcontentloaded', { timeout: 3000 })
        .catch(() => null);
      await page.waitForTimeout(250);
    }
  }

  throw new Error('Failed to detect Cengage page state.');
}
