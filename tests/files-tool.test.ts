import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  getWithMeta: vi.fn(),
  set: vi.fn(),
  parsePdfSmart: vi.fn(),
  parseDocx: vi.fn(),
  parsePptx: vi.fn(),
  handleEclassSessionExpired: vi.fn(),
}));

vi.mock('../src/scraper/eclass', () => {
  class SessionExpiredError extends Error {}
  class ScrapeLayoutError extends Error {
    context?: Record<string, unknown>;
    constructor(message: string, context?: Record<string, unknown>) {
      super(message);
      this.context = context;
    }
  }
  class UpstreamError extends Error {
    code: string;
    httpStatus?: number;
    constructor(code: string, message: string, httpStatus?: number) {
      super(message);
      this.code = code;
      this.httpStatus = httpStatus;
    }
  }

  return {
    scraper: { downloadFile: mocks.downloadFile },
    SessionExpiredError,
    ScrapeLayoutError,
    UpstreamError,
  };
});

vi.mock('../src/cache/store', () => ({
  cache: {
    getWithMeta: mocks.getWithMeta,
    set: mocks.set,
  },
  TTL: { FILES: 60 },
  getCacheKey: (...parts: string[]) => parts.join(':'),
}));

vi.mock('../src/cache/account-scope', () => ({
  tryGetEclassCacheKey: (prefix: string, ...segments: string[]) =>
    [prefix, ...segments].join(':'),
}));

vi.mock('../src/parser/pdf-analyzer', () => ({
  parsePdfSmart: mocks.parsePdfSmart,
}));

vi.mock('../src/parser/docx', () => ({
  parseDocx: mocks.parseDocx,
}));

vi.mock('../src/parser/pptx', () => ({
  parsePptx: mocks.parsePptx,
}));

vi.mock('../src/auth/server', () => ({
  getAuthUrl: () => 'http://localhost:3000/auth',
}));

vi.mock('../src/tools/auth-retry', () => ({
  handleEclassSessionExpired: mocks.handleEclassSessionExpired,
  isSessionStorageUnavailable: () => false,
  sessionStorageUnavailableResponse: vi.fn(),
}));

import {
  ScrapeLayoutError,
  SessionExpiredError,
  UpstreamError,
} from '../src/scraper/eclass';
import { getFileText } from '../src/tools/files';

function textBlocks(result: {
  content: Array<Record<string, unknown>>;
}): string[] {
  return result.content.map((block) =>
    typeof block.text === 'string' ? block.text : ''
  );
}

function jsonPayload(result: { content: Array<Record<string, unknown>> }) {
  const text = result.content[0].text;
  return JSON.parse(typeof text === 'string' ? text : '{}');
}

describe('getFileText tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWithMeta.mockReturnValue(null);
  });

  it('serves cached string and stale block-array file text without downloading', async () => {
    mocks.getWithMeta.mockReturnValueOnce({ data: 'cached text' });
    expect(
      textBlocks(
        await getFileText(
          'course',
          'https://eclass.yorku.ca/pluginfile.php/1/a.pdf'
        )
      )
    ).toEqual(['cached text']);

    mocks.getWithMeta.mockReturnValueOnce({
      stale: true,
      data: [
        { type: 'text', text: 'cached block' },
        { type: 'image', data: 'abc', mimeType: 'image/png' },
      ],
    });
    const stale = await getFileText(
      'course',
      'https://eclass.yorku.ca/pluginfile.php/1/a.pdf',
      2,
      3
    );
    expect(textBlocks(stale)).toEqual([
      '[Pinned cache past TTL — content may be stale. Use cache_refresh_pin to refresh.]',
      'cached block',
      '',
    ]);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it('parses PDFs, DOCX, and PPTX downloads and caches extracted blocks', async () => {
    mocks.downloadFile
      .mockResolvedValueOnce({
        buffer: Buffer.from('pdf'),
        mimeType: 'application/pdf',
        filename: 'lecture.pdf',
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from('docx'),
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'notes.bin',
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from('pptx'),
        mimeType: 'application/octet-stream',
        filename: 'slides.pptx',
      });
    mocks.parsePdfSmart.mockResolvedValue([{ type: 'text', text: 'pdf text' }]);
    mocks.parseDocx.mockResolvedValue('docx text');
    mocks.parsePptx.mockResolvedValue('pptx text');

    expect(
      textBlocks(
        await getFileText(
          'course',
          'https://eclass.yorku.ca/pluginfile.php/1/lecture',
          1,
          2
        )
      )
    ).toEqual(['pdf text']);
    expect(
      textBlocks(
        await getFileText(
          'course',
          'https://eclass.yorku.ca/pluginfile.php/1/notes'
        )
      )
    ).toEqual(['docx text']);
    expect(
      textBlocks(
        await getFileText(
          'course',
          'https://eclass.yorku.ca/pluginfile.php/1/slides'
        )
      )
    ).toEqual(['pptx text']);

    expect(mocks.parsePdfSmart).toHaveBeenCalledWith(Buffer.from('pdf'), 1, 2);
    expect(mocks.set).toHaveBeenCalledTimes(3);
  });

  it('returns useful text for unsupported and empty extracted files', async () => {
    mocks.downloadFile
      .mockResolvedValueOnce({
        buffer: Buffer.from('csv'),
        mimeType: 'text/csv',
        filename: 'grades.csv',
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from('empty'),
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'empty.docx',
      });
    mocks.parseDocx.mockResolvedValue('');

    expect(
      textBlocks(
        await getFileText(
          'course',
          'https://eclass.yorku.ca/pluginfile.php/1/grades'
        )
      )
    ).toEqual(['Unsupported file type: text/csv (grades.csv)']);
    expect(
      textBlocks(
        await getFileText(
          'course',
          'https://eclass.yorku.ca/pluginfile.php/1/empty'
        )
      )
    ).toEqual([
      '[No text could be extracted from this file. It may be a scanned document or unsupported format.]',
    ]);
  });

  it('maps known scraper errors to structured tool responses', async () => {
    mocks.downloadFile.mockRejectedValueOnce(
      new ScrapeLayoutError('layout moved', { selector: '.missing' })
    );
    let payload = jsonPayload(
      await getFileText(
        'course',
        'https://eclass.yorku.ca/pluginfile.php/1/layout'
      )
    );
    expect(payload.status).toBe('error');
    expect(payload.code).toBe('SCRAPE_LAYOUT_CHANGED');
    expect(payload.details.selector).toBe('.missing');

    mocks.downloadFile.mockRejectedValueOnce(
      new UpstreamError('TIMEOUT', 'Moodle timed out', 504)
    );
    payload = jsonPayload(
      await getFileText(
        'course',
        'https://eclass.yorku.ca/pluginfile.php/1/upstream'
      )
    );
    expect(payload.code).toBe('TIMEOUT');
    expect(payload.details.httpStatus).toBe(504);

    mocks.downloadFile.mockRejectedValueOnce(
      new UpstreamError('UPSTREAM_ERROR', 'Moodle broke')
    );
    payload = jsonPayload(
      await getFileText(
        'course',
        'https://eclass.yorku.ca/pluginfile.php/1/upstream2'
      )
    );
    expect(payload.code).toBe('UPSTREAM_ERROR');
    expect(payload.details).toBeUndefined();
  });

  it('delegates expired sessions to the shared auth retry helper', async () => {
    const sessionError = new SessionExpiredError('expired');
    const fallback = { content: [{ type: 'text', text: 'auth_required' }] };
    mocks.downloadFile.mockRejectedValueOnce(sessionError);
    mocks.handleEclassSessionExpired.mockResolvedValue(fallback);

    const result = await getFileText(
      'course',
      'https://eclass.yorku.ca/pluginfile.php/1/auth'
    );

    expect(result).toBe(fallback);
    expect(mocks.handleEclassSessionExpired).toHaveBeenCalledWith(
      sessionError,
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('rejects unsafe file URLs before download', async () => {
    const result = jsonPayload(
      await getFileText(
        'course',
        'https://eclass.yorku.ca.evil.test/pluginfile.php/1/a.pdf'
      )
    );

    expect(result.code).toBe('VALIDATION_FAILED');
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });
});
