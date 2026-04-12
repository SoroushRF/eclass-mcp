import type { Page } from 'playwright';

export type CengagePageState =
  | 'login'
  | 'dashboard'
  | 'enrollment'
  | 'student_home'
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
  hasInterstitialText?: boolean;
}

export interface CengagePageStateTransition {
  state: CengagePageState;
  reason: string;
  url: string;
}

export interface WaitForCengagePageStateOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  stableReadings?: number;
  acceptableStates?: CengagePageState[];
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
      hasInterstitialText: boolean;
      hasWebassignStudentUrl: boolean;
      hasWebassignLoginWithCourseKey: boolean;
      hasGetEnrolledCourseKey: boolean;
      hasDashboardUrl: boolean;
      hasLoginUrl: boolean;
    };
    transitionPath?: CengagePageStateTransition[];
    detectionAttempts?: number;
  };
}

const DEFAULT_SETTLED_STATES: readonly CengagePageState[] = [
  'login',
  'dashboard',
  'enrollment',
  'student_home',
  'course',
  'assignments',
];

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

  const hasInterstitialText =
    !!signals.hasInterstitialText ||
    /redirect|please wait|loading|authorizing|one moment/i.test(lowerTitle) ||
    /redirect|please wait|loading|authorizing|one moment/i.test(lowerBody);

  return {
    url,
    title,
    hasPasswordInput,
    hasLoginButton,
    hasAssignmentsWrapper,
    hasDueDateText,
    hasPastAssignmentsButton,
    hasCourseLinks,
    hasInterstitialText,
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

  if (normalized.hasGetEnrolledCourseKey) {
    return {
      state: 'enrollment',
      reason:
        'Detected getenrolled enrollment/registration context before course launch.',
      diagnostics: {
        url: normalized.url,
        title: normalized.title,
        markers: {
          ...normalized,
        },
      },
    };
  }

  if (normalized.hasWebassignStudentUrl) {
    return {
      state: 'student_home',
      reason: 'Detected WebAssign student-home context.',
      diagnostics: {
        url: normalized.url,
        title: normalized.title,
        markers: {
          ...normalized,
        },
      },
    };
  }

  if (normalized.hasWebassignLoginWithCourseKey) {
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

  if (normalized.hasInterstitialText) {
    return {
      state: 'unknown',
      reason:
        'Detected redirect/interstitial loading markers while navigation is still settling.',
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
      hasInterstitialText:
        /redirect|please wait|loading|authorizing|one moment/i.test(bodyText),
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

function withTransitionDiagnostics(
  result: CengagePageStateResult,
  transitions: CengagePageStateTransition[],
  attempts: number
): CengagePageStateResult {
  return {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      transitionPath: transitions,
      detectionAttempts: attempts,
    },
  };
}

export async function waitForCengagePageState(
  page: Page,
  options: WaitForCengagePageStateOptions = {}
): Promise<CengagePageStateResult> {
  const timeoutMs = Math.max(500, options.timeoutMs ?? 12000);
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 350);
  const stableReadings = Math.max(1, options.stableReadings ?? 2);
  const acceptableStates = options.acceptableStates ?? [
    ...DEFAULT_SETTLED_STATES,
  ];

  const transitions: CengagePageStateTransition[] = [];
  const deadline = Date.now() + timeoutMs;

  let attempts = 0;
  let stableCount = 0;
  let lastSignature = '';
  let lastResult: CengagePageStateResult | null = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    const result = await detectCengagePageState(page);
    const signature = `${result.state}|${result.diagnostics.url}`;

    if (signature !== lastSignature) {
      transitions.push({
        state: result.state,
        reason: result.reason,
        url: result.diagnostics.url,
      });
      stableCount = 1;
      lastSignature = signature;
    } else {
      stableCount += 1;
    }

    lastResult = result;

    if (
      acceptableStates.includes(result.state) &&
      stableCount >= stableReadings
    ) {
      return withTransitionDiagnostics(result, transitions, attempts);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await page.waitForTimeout(Math.min(pollIntervalMs, remainingMs));
  }

  if (lastResult) {
    return withTransitionDiagnostics(lastResult, transitions, attempts);
  }

  throw new Error('Failed to detect Cengage page state.');
}
