import { describe, expect, it } from 'vitest';
import { isEClassAuthPage } from '../src/scraper/eclass/helpers';

describe('eclass auth page detection', () => {
  it('detects auth pages by login-like URL markers', () => {
    expect(
      isEClassAuthPage({
        url: 'https://eclass.yorku.ca/login/index.php',
      })
    ).toBe(true);

    expect(
      isEClassAuthPage({
        url: 'https://passportyork.yorku.ca/ppylogin/ppylogin',
      })
    ).toBe(true);
  });

  it('detects Passport York login pages by title/body/form markers', () => {
    expect(
      isEClassAuthPage({
        url: 'https://eclass.yorku.ca/my/courses.php',
        title: 'Passport York Login',
        hasPasswordInput: true,
        hasLoginForm: true,
        hasPassportYorkMarker: true,
        bodyTextSnippet: 'Passport York Login New to Passport York?',
      })
    ).toBe(true);
  });

  it('does not mark normal course pages as auth pages', () => {
    expect(
      isEClassAuthPage({
        url: 'https://eclass.yorku.ca/my/courses.php',
        title: 'Dashboard',
        hasPasswordInput: false,
        hasLoginForm: false,
        hasPassportYorkMarker: false,
        bodyTextSnippet: 'My courses Upcoming deadlines',
      })
    ).toBe(false);
  });

  it('does not over-trigger on password fields without auth form markers', () => {
    expect(
      isEClassAuthPage({
        url: 'https://eclass.yorku.ca/mod/quiz/view.php?id=123',
        title: 'Quiz',
        hasPasswordInput: true,
        hasLoginForm: false,
        hasPassportYorkMarker: false,
        bodyTextSnippet: 'Enter quiz password to begin',
      })
    ).toBe(false);
  });
});
