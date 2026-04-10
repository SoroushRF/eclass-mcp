import { describe, expect, it } from 'vitest';
import {
  classifyCengagePageState,
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

  it('detects course when on webassign student URL without assignment markers', () => {
    const result = classify({
      url: 'https://www.webassign.net/web/Student/Home.html',
      title: 'WebAssign Student Home',
    });

    expect(result.state).toBe('course');
  });

  it('detects course when webassign login includes courseKey', () => {
    const result = classify({
      url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
    });

    expect(result.state).toBe('course');
  });

  it('detects dashboard from known dashboard URL', () => {
    const result = classify({
      url: 'https://www.cengage.com/dashboard/home',
      title: 'Dashboard',
    });

    expect(result.state).toBe('dashboard');
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
});
