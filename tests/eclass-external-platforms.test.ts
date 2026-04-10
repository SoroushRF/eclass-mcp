import { describe, expect, it } from 'vitest';
import {
  classifyExternalPlatformCandidate,
  normalizeExternalPlatformUrl,
} from '../src/scraper/eclass/external-platforms';

describe('eClass external platform classifier', () => {
  it('classifies LTI Cengage links with lti signal', () => {
    const result = classifyExternalPlatformCandidate({
      name: 'Cengage MindTap Launch',
      url: 'https://eclass.yorku.ca/mod/lti/view.php?id=12345',
      itemType: 'lti',
    });

    expect(result).toEqual({
      name: 'cengage',
      url: 'https://eclass.yorku.ca/mod/lti/view.php?id=12345',
      signal: 'lti',
    });
  });

  it('classifies unknown LTI links explicitly as unknown_lti', () => {
    const result = classifyExternalPlatformCandidate({
      name: 'External Tool',
      url: 'https://eclass.yorku.ca/mod/lti/view.php?id=22222',
      itemType: 'lti',
    });

    expect(result).toEqual({
      name: 'unknown_lti',
      url: 'https://eclass.yorku.ca/mod/lti/view.php?id=22222',
      signal: 'lti',
    });
  });

  it('classifies direct non-LTI WebAssign URLs by keyword_url', () => {
    const result = classifyExternalPlatformCandidate({
      name: 'Homework Platform',
      url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
      itemType: 'other',
    });

    expect(result).toEqual({
      name: 'cengage',
      url: 'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
      signal: 'keyword_url',
    });
  });

  it('classifies Moodle URL activity wrappers using name keywords', () => {
    const result = classifyExternalPlatformCandidate({
      name: 'Open Cengage dashboard',
      url: 'https://eclass.yorku.ca/mod/url/view.php?id=33333',
      itemType: 'url',
    });

    expect(result).toEqual({
      name: 'cengage',
      url: 'https://eclass.yorku.ca/mod/url/view.php?id=33333',
      signal: 'url_activity',
    });
  });

  it('classifies resource activity wrappers using name keywords', () => {
    const result = classifyExternalPlatformCandidate({
      name: 'WebAssign Link Resource',
      url: 'https://eclass.yorku.ca/mod/resource/view.php?id=44444',
      itemType: 'resource',
    });

    expect(result).toEqual({
      name: 'cengage',
      url: 'https://eclass.yorku.ca/mod/resource/view.php?id=44444',
      signal: 'resource_activity',
    });
  });

  it('returns null for non-platform links', () => {
    const result = classifyExternalPlatformCandidate({
      name: 'Lecture Slides',
      url: 'https://eclass.yorku.ca/mod/resource/view.php?id=99999',
      itemType: 'resource',
    });

    expect(result).toBeNull();
  });

  it('normalizes platform URLs by stripping fragments', () => {
    const normalized = normalizeExternalPlatformUrl(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1234#launch'
    );

    expect(normalized).toBe(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1234'
    );
  });
});
