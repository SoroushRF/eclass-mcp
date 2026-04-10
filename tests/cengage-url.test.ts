import { describe, expect, it } from 'vitest';
import {
  classifyCengageUrl,
  normalizeAndClassifyCengageEntry,
} from '../src/scraper/cengage-url';
import { CengageInvalidInputError } from '../src/scraper/cengage-errors';

describe('cengage URL classifier', () => {
  it('classifies eClass LTI launch links', () => {
    const parsed = normalizeAndClassifyCengageEntry(
      'https://eclass.yorku.ca/mod/lti/view.php?id=12345'
    );

    expect(parsed.linkType).toBe('eclass_lti');
    expect(parsed.host).toBe('eclass.yorku.ca');
  });

  it('classifies real WebAssign course login links', () => {
    const parsed = normalizeAndClassifyCengageEntry(
      'https://www.webassign.net/v4cgi/login.pl?pid=571417&eISBN=9780357128992&courseKey=WA-production-1607530'
    );

    expect(parsed.linkType).toBe('webassign_course');
    expect(parsed.normalizedUrl).toContain('courseKey=WA-production-1607530');
  });

  it('classifies WebAssign dashboard/student links', () => {
    const parsed = normalizeAndClassifyCengageEntry(
      'https://www.webassign.net/web/Student/Home.html'
    );

    expect(parsed.linkType).toBe('webassign_dashboard');
  });

  it('classifies Cengage login links', () => {
    const parsed = normalizeAndClassifyCengageEntry(
      'https://login.cengage.com/'
    );

    expect(parsed.linkType).toBe('cengage_login');
  });

  it('classifies Cengage dashboard-like links', () => {
    const parsed = normalizeAndClassifyCengageEntry(
      'https://www.cengage.com/dashboard/home'
    );

    expect(parsed.linkType).toBe('cengage_dashboard');
  });

  it('extracts URL from mixed text input from debug logs', () => {
    const parsed = normalizeAndClassifyCengageEntry(
      'OPEN WEBASSIGN -> https://www.webassign.net/v4cgi/login.pl?pid=571417&eISBN=9780357128992&courseKey=WA-production-1607530'
    );

    expect(parsed.extractedUrl).toBe(
      'https://www.webassign.net/v4cgi/login.pl?pid=571417&eISBN=9780357128992&courseKey=WA-production-1607530'
    );
    expect(parsed.linkType).toBe('webassign_course');
  });

  it('normalizes html-escaped query params and drops fragments', () => {
    const parsed = normalizeAndClassifyCengageEntry(
      'https://www.webassign.net/v4cgi/login.pl?pid=571417&amp;courseKey=WA-production-1607530#section1'
    );

    expect(parsed.normalizedUrl).toBe(
      'https://www.webassign.net/v4cgi/login.pl?pid=571417&courseKey=WA-production-1607530'
    );
  });

  it('throws for input with no URL', () => {
    expect(() =>
      normalizeAndClassifyCengageEntry('please open my cengage')
    ).toThrow(CengageInvalidInputError);
  });

  it('throws for unsupported protocols', () => {
    expect(() =>
      normalizeAndClassifyCengageEntry('ftp://login.cengage.com')
    ).toThrow(CengageInvalidInputError);
  });

  it('classifyCengageUrl returns other for unrelated domains', () => {
    const type = classifyCengageUrl(new URL('https://example.org/path'));
    expect(type).toBe('other');
  });
});
