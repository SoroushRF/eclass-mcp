import { describe, expect, it, vi } from 'vitest';
import {
  classifyCengagePageState,
  detectCengagePageState,
  waitForCengagePageState,
  type CengagePageStateSignals,
} from '../src/scraper/cengage-state';

function classify(signals: CengagePageStateSignals) {
  return classifyCengagePageState(signals);
}

describe('cengage page state detector', () => {
  it('detects login from login URL', () => {
    const result = classify({
      url: 'https://login.cengage.com/',
      title: 'Sign In',
    });

    expect(result.state).toBe('login');
  });

  it('detects login from form markers even without login URL', () => {
    const result = classify({
      url: 'https://www.cengage.com/some/path',
      hasPasswordInput: true,
      hasLoginButton: true,
    });

    expect(result.state).toBe('login');
  });

  it('detects assignments from webassign student URL plus due-date markers', () => {
    const result = classify({
      url: 'https://www.webassign.net/web/Student/Home.html',
      hasDueDateText: true,
    });

    expect(result.state).toBe('assignments');
  });

  it('detects student-home when on webassign student URL without assignment markers', () => {
    const result = classify({
      url: 'https://www.webassign.net/web/Student/Home.html',
      title: 'WebAssign Student Home',
    });

    expect(result.state).toBe('student_home');
  });

  it('detects course when webassign login includes courseKey', () => {
    const result = classify({
      url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
    });

    expect(result.state).toBe('course');
  });

  it('detects enrollment when getenrolled link carries a courseKey', () => {
    const result = classify({
      url: 'https://www.getenrolled.com/?courseKey=yorku.ca73866101',
    });

    expect(result.state).toBe('enrollment');
    expect(result.diagnostics.markers.hasGetEnrolledCourseKey).toBe(true);
  });

  it('detects dashboard from known dashboard URL', () => {
    const result = classify({
      url: 'https://www.cengage.com/dashboard/home',
      title: 'Dashboard',
    });

    expect(result.state).toBe('dashboard');
  });

  it('detects dashboard from cengage.ca dashboard URL variant', () => {
    const result = classify({
      url: 'https://www.cengage.ca/dashboard/home',
      title: 'Cengage Learning',
    });

    expect(result.state).toBe('dashboard');
    expect(result.diagnostics.markers.hasDashboardUrl).toBe(true);
  });

  it('detects dashboard from course links marker', () => {
    const result = classify({
      url: 'https://www.cengage.com/some/landing/page',
      hasCourseLinks: true,
    });

    expect(result.state).toBe('dashboard');
  });

  it('falls back to unknown when no known markers exist', () => {
    const result = classify({
      url: 'https://example.org/path',
      title: 'Example',
      bodyTextSnippet: 'hello world',
    });

    expect(result.state).toBe('unknown');
  });

  it('retries transient navigation errors before collecting page signals', async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'page.evaluate: Execution context was destroyed, most likely because of a navigation'
        )
      )
      .mockResolvedValueOnce({
        title: 'Dashboard',
        bodyTextSnippet: 'my courses',
        hasPasswordInput: false,
        hasLoginButton: false,
        hasAssignmentsWrapper: false,
        hasDueDateText: false,
        hasPastAssignmentsButton: false,
        hasCourseLinks: true,
      });

    const page = {
      evaluate,
      url: () => 'https://www.cengage.com/dashboard/home',
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await detectCengagePageState(page);
    expect(result.state).toBe('dashboard');
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(page.waitForLoadState).toHaveBeenCalled();
  });

  it('waits through redirect/interstitial states and settles on dashboard', async () => {
    let callCount = 0;
    let currentUrl = 'https://login.cengage.com/oidc/authorize';

    const evaluate = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return {
          title: 'Redirecting... Please wait',
          bodyTextSnippet: 'Please wait while we redirect you',
          hasPasswordInput: false,
          hasLoginButton: false,
          hasAssignmentsWrapper: false,
          hasDueDateText: false,
          hasPastAssignmentsButton: false,
          hasCourseLinks: false,
          hasInterstitialText: true,
        };
      }

      currentUrl = 'https://www.cengage.com/dashboard/home';
      return {
        title: 'Dashboard',
        bodyTextSnippet: 'My Courses',
        hasPasswordInput: false,
        hasLoginButton: false,
        hasAssignmentsWrapper: false,
        hasDueDateText: false,
        hasPastAssignmentsButton: false,
        hasCourseLinks: true,
        hasInterstitialText: false,
      };
    });

    const page = {
      evaluate,
      url: () => currentUrl,
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await waitForCengagePageState(page, {
      timeoutMs: 2000,
      pollIntervalMs: 1,
      stableReadings: 1,
      acceptableStates: ['dashboard'],
    });

    expect(result.state).toBe('dashboard');
    expect(result.diagnostics.transitionPath?.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.transitionPath?.[0]?.state).toBe('unknown');
    expect(result.diagnostics.transitionPath?.[1]?.state).toBe('dashboard');
  });
});
