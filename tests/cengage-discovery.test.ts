import { describe, expect, it } from 'vitest';
import {
  discoverCengageLinks,
  discoverCengageLinksFromText,
} from '../src/tools/cengage';

describe('cengage link discovery', () => {
  it('discovers and classifies mixed Cengage/WebAssign links', () => {
    const result = discoverCengageLinksFromText({
      text: [
        'Please open https://eclass.yorku.ca/mod/lti/view.php?id=12345',
        'Then launch https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1607530',
        'Dashboard: https://www.cengage.com/dashboard/home',
      ].join('\n'),
      source: 'course_content',
      courseId: '12345',
    });

    expect(result.status).toBe('ok');
    expect(result.links).toHaveLength(3);

    expect(result.links[0].linkType).toBe('eclass_lti');
    expect(result.links[1].linkType).toBe('webassign_course');
    expect(result.links[2].linkType).toBe('cengage_dashboard');

    for (const link of result.links) {
      expect(link.source).toBe('course_content');
      expect(link.sourceHint).toContain('line:');
      expect(link.sourceHint).toContain('courseId:12345');
    }
  });

  it('dedupes repeated links with deterministic normalized URLs', () => {
    const result = discoverCengageLinksFromText({
      text: [
        'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001#section1',
        'duplicate https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001',
      ].join('\n'),
      source: 'manual',
    });

    expect(result.status).toBe('ok');
    expect(result.links).toHaveLength(1);
    expect(result.links[0].normalizedUrl).toBe(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-1001'
    );
  });

  it('returns no_data when no candidate links are present', () => {
    const result = discoverCengageLinksFromText({
      text: 'No external links here, only plain text.',
      source: 'announcement',
    });

    expect(result.status).toBe('no_data');
    expect(result.links).toHaveLength(0);
    expect(result.message).toContain('No Cengage/WebAssign links');
  });

  it('ignores unrelated domains and keeps likely cengage hosts', () => {
    const result = discoverCengageLinksFromText({
      text: [
        'Ignore https://example.org/course/123',
        'Keep https://www.cengage.com/some/unknown/path',
      ].join('\n'),
      source: 'section_text',
      sectionUrl: 'https://eclass.yorku.ca/course/view.php?id=99#section-3',
    });

    expect(result.status).toBe('ok');
    expect(result.links).toHaveLength(1);
    expect(result.links[0].normalizedUrl).toBe(
      'https://www.cengage.com/some/unknown/path'
    );
    expect(result.links[0].linkType).toBe('other');
    expect(result.links[0].sourceHint).toContain('sectionUrl:');
  });

  it('returns cache metadata and serves repeat requests as cache hits', async () => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const input = {
      text: `Use https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-${nonce}`,
      source: 'manual' as const,
    };

    const first = await discoverCengageLinks(input);
    const firstPayload = JSON.parse(first.content[0].text);
    expect(firstPayload._cache).toBeDefined();
    expect(firstPayload._cache.hit).toBe(false);

    const second = await discoverCengageLinks(input);
    const secondPayload = JSON.parse(second.content[0].text);
    expect(secondPayload._cache).toBeDefined();
    expect(secondPayload._cache.hit).toBe(true);
  });
});
