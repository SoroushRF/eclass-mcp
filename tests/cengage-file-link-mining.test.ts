import { describe, expect, it } from 'vitest';
import {
  discoverCengageLinksFromFileBlocks,
  discoverCengageLinksFromText,
} from '../src/tools/cengage';

describe('cengage file link mining utility', () => {
  it('mines links from extracted file text blocks with confidence and source-file metadata', () => {
    const result = discoverCengageLinksFromFileBlocks({
      blocks: [
        {
          type: 'text',
          text: 'See https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-4100 for homework.',
        },
        {
          type: 'text',
          text: 'Dashboard link: https://www.cengage.com/dashboard/home',
        },
      ],
      sourceFile: {
        fileName: 'MATH1010-syllabus.pdf',
        fileUrl:
          'https://eclass.yorku.ca/pluginfile.php/12345/mod_resource/content/1/syllabus.pdf',
        fileType: 'pdf',
      },
      courseId: '4100',
    });

    expect(result.status).toBe('ok');
    expect(result.links).toHaveLength(2);

    const webassign = result.links.find(
      (l) => l.linkType === 'webassign_course'
    );
    const dashboard = result.links.find(
      (l) => l.linkType === 'cengage_dashboard'
    );

    expect(webassign).toBeDefined();
    expect(dashboard).toBeDefined();

    for (const link of result.links) {
      expect(link.source).toBe('file_text');
      expect(link.confidence).toBeGreaterThan(0);
      expect(link.sourceFile?.fileName).toBe('MATH1010-syllabus.pdf');
      expect(link.sourceFile?.fileUrl).toContain('pluginfile.php');
      expect(link.sourceFile?.fileType).toBe('pdf');
      expect(typeof link.sourceFile?.blockIndex).toBe('number');
    }
  });

  it('dedupes repeated links across blocks and keeps deterministic metadata', () => {
    const result = discoverCengageLinksFromFileBlocks({
      blocks: [
        {
          type: 'text',
          text: 'Primary link: https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-5000',
        },
        {
          type: 'text',
          text: 'Duplicate with fragment https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-5000#launch',
        },
      ],
      sourceFile: { fileName: 'outline.docx', fileType: 'docx' },
    });

    expect(result.status).toBe('ok');
    expect(result.links).toHaveLength(1);
    expect(result.links[0].normalizedUrl).toBe(
      'https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-5000'
    );
    expect(result.links[0].sourceFile?.blockIndex).toBe(0);
  });

  it('returns no_data when blocks do not contain usable text links', () => {
    const result = discoverCengageLinksFromFileBlocks({
      blocks: [{ type: 'image' }, { type: 'text', text: '   ' }],
      sourceFile: { fileName: 'slides.pptx', fileType: 'pptx' },
    });

    expect(result.status).toBe('no_data');
    expect(result.links).toEqual([]);
  });

  it('passes source-file metadata through text discovery when provided', () => {
    const result = discoverCengageLinksFromText({
      text: 'Launch at https://www.webassign.net/v4cgi/login.pl?courseKey=WA-production-7000',
      source: 'file_text',
      sourceFile: {
        fileName: 'lab-handout.pdf',
        fileUrl: 'https://eclass.yorku.ca/pluginfile.php/777/lab-handout.pdf',
        fileType: 'pdf',
        blockIndex: 3,
      },
    });

    expect(result.status).toBe('ok');
    expect(result.links).toHaveLength(1);
    expect(result.links[0].sourceFile).toEqual({
      fileName: 'lab-handout.pdf',
      fileUrl: 'https://eclass.yorku.ca/pluginfile.php/777/lab-handout.pdf',
      fileType: 'pdf',
      blockIndex: 3,
    });
    expect(result.links[0].sourceHint).toContain('file:lab-handout.pdf');
    expect(result.links[0].sourceHint).toContain('block:3');
  });
});
