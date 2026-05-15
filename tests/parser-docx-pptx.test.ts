import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocx } from '../src/parser/docx';
import { parsePptx } from '../src/parser/pptx';

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

const mammothMock = vi.mocked(mammoth.extractRawText);

afterEach(() => {
  vi.restoreAllMocks();
  mammothMock.mockReset();
});

describe('document parser behavior', () => {
  it('normalizes DOCX raw text into trimmed plain text', async () => {
    mammothMock.mockResolvedValue({
      value: '  First line   \r\nSecond line  \n\n\nThird line   \n',
      messages: [],
    });

    const text = await parseDocx(Buffer.from('docx bytes'));

    expect(text).toBe('First line\nSecond line\nThird line');
    expect(mammothMock).toHaveBeenCalledWith({
      buffer: Buffer.from('docx bytes'),
    });
  });

  it('returns an empty DOCX result and logs when mammoth cannot parse the file', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mammothMock.mockRejectedValue(new Error('corrupt docx'));

    const text = await parseDocx(Buffer.from('not really a docx'));

    expect(text).toBe('');
    expect(errorSpy).toHaveBeenCalledWith(
      'Error parsing DOCX:',
      expect.any(Error)
    );
  });

  it('extracts PPTX slide XML in numeric slide order', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'ppt/slides/slide10.xml',
      Buffer.from('<p:sld><a:t>Tenth slide</a:t></p:sld>')
    );
    zip.addFile(
      'ppt/slides/slide2.xml',
      Buffer.from('<p:sld><a:t>Second slide</a:t></p:sld>')
    );
    zip.addFile(
      'ppt/slides/slide1.xml',
      Buffer.from('<p:sld><a:t>First slide</a:t></p:sld>')
    );
    zip.addFile('ppt/notesSlides/notesSlide1.xml', Buffer.from('ignore me'));

    const text = await parsePptx(zip.toBuffer());

    expect(text).toBe(
      [
        '--- Slide 1 ---',
        'First slide',
        '',
        '--- Slide 2 ---',
        'Second slide',
        '',
        '--- Slide 10 ---',
        'Tenth slide',
      ].join('\n')
    );
  });

  it('returns empty PPTX text and logs when the zip payload is invalid', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const text = await parsePptx(Buffer.from('not a zip'));

    expect(text).toBe('');
    expect(errorSpy).toHaveBeenCalledWith(
      'Error parsing PPTX:',
      expect.any(Error)
    );
  });
});
