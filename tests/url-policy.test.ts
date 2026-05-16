import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors/validation-error';
import {
  isAllowedUrlForPolicy,
  validateUrlForPolicy,
} from '../src/security/url-policy';

describe('URL security policy', () => {
  it('accepts allowed eClass file, section, and item URLs', () => {
    expect(
      validateUrlForPolicy(
        'https://eclass.yorku.ca/pluginfile.php/123/file.pdf',
        'eclass_file'
      )
    ).toBe('https://eclass.yorku.ca/pluginfile.php/123/file.pdf');

    expect(
      validateUrlForPolicy(
        'https://eclass.yorku.ca/course/view.php?id=123%20%20&section=2#top',
        'eclass_section'
      )
    ).toBe('https://eclass.yorku.ca/course/view.php?id=123&section=2');

    expect(
      validateUrlForPolicy(
        'https://eclass.yorku.ca/mod/assign/view.php?id=123',
        'eclass_item'
      )
    ).toBe('https://eclass.yorku.ca/mod/assign/view.php?id=123');

    expect(
      validateUrlForPolicy(
        'https://eclass.yorku.ca/mod/quiz/view.php?id=123',
        'eclass_item'
      )
    ).toBe('https://eclass.yorku.ca/mod/quiz/view.php?id=123');
  });

  it('accepts allowed Cengage and WebAssign entry URLs', () => {
    expect(
      validateUrlForPolicy(
        'https://eclass.yorku.ca/mod/lti/view.php?id=123',
        'cengage_entry'
      )
    ).toContain('/mod/lti/view.php?id=123');

    expect(
      validateUrlForPolicy(
        'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1',
        'cengage_entry'
      )
    ).toContain('courseKey=WA-production-1');

    expect(
      validateUrlForPolicy(
        'https://www.getenrolled.com/?courseKey=yorku.ca123',
        'cengage_entry'
      )
    ).toBe('https://www.getenrolled.com/?courseKey=yorku.ca123');

    expect(
      validateUrlForPolicy(
        'https://www.cengage.com/dashboard/home',
        'cengage_entry'
      )
    ).toBe('https://www.cengage.com/dashboard/home');

    expect(
      validateUrlForPolicy(
        'https://www.cengage.ca/mindtap/course',
        'cengage_entry'
      )
    ).toBe('https://www.cengage.ca/mindtap/course');

    expect(
      validateUrlForPolicy('https://login.cengage.com/', 'cengage_entry')
    ).toBe('https://login.cengage.com/');
  });

  it('accepts post-navigation Cengage page hosts without broad entry paths', () => {
    expect(
      validateUrlForPolicy(
        'https://www.webassign.net/any/post-login/path',
        'cengage_page'
      )
    ).toBe('https://www.webassign.net/any/post-login/path');
    expect(
      validateUrlForPolicy(
        'https://www.getenrolled.com/landing',
        'cengage_page'
      )
    ).toBe('https://www.getenrolled.com/landing');
  });

  it('allows public discovery metadata URLs while still blocking local URLs', () => {
    expect(
      validateUrlForPolicy('https://example.org/syllabus', 'discovery_metadata')
    ).toBe('https://example.org/syllabus');
    expect(() =>
      validateUrlForPolicy('https://127.0.0.1/syllabus', 'discovery_metadata')
    ).toThrow(ValidationError);
  });

  it('reports empty and malformed URL inputs as validation failures', () => {
    expect(() => validateUrlForPolicy('', 'eclass_file')).toThrow(
      ValidationError
    );
    expect(() => validateUrlForPolicy('not a url', 'eclass_file')).toThrow(
      ValidationError
    );
  });

  it.each([
    'http://eclass.yorku.ca/pluginfile.php/1/a.pdf',
    'https://eclass.yorku.ca.evil.test/pluginfile.php/1/a.pdf',
    'https://www.webassign.net.evil.test/v4cgi/login.pl?courseKey=x',
    'https://user:pass@eclass.yorku.ca/pluginfile.php/1/a.pdf',
    'file:///C:/Users/me/secret.txt',
    'data:text/html,<h1>x</h1>',
    'javascript:alert(1)',
    'https://localhost/pluginfile.php/1/a.pdf',
    'https://127.0.0.1/pluginfile.php/1/a.pdf',
    'https://10.0.0.1/pluginfile.php/1/a.pdf',
    'https://192.168.1.1/pluginfile.php/1/a.pdf',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/pluginfile.php/1/a.pdf',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validateUrlForPolicy(url, 'eclass_file')).toThrow(
      ValidationError
    );
    expect(isAllowedUrlForPolicy(url, 'eclass_file')).toBe(false);
  });

  it('redacts sensitive values in validation details', () => {
    try {
      validateUrlForPolicy(
        'https://eclass.yorku.ca.evil.test/pluginfile.php/1/a.pdf?sesskey=secret&ok=1',
        'eclass_file'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details?.url).toContain(
        'sesskey=%5BRedacted%5D'
      );
      expect((error as ValidationError).details?.url).not.toContain('secret');
    }
  });
});
