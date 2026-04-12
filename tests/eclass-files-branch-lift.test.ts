import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from '../src/scraper/eclass/files';
import { ScrapeLayoutError, UpstreamError } from '../src/scraper/scrape-errors';

interface MockResponseInput {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
}

function makeResponse(input: MockResponseInput) {
  return {
    ok: () => input.ok,
    status: () => input.status,
    headers: () => input.headers,
    body: async () => input.body,
    url: () => input.url,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('eclass file download branch coverage lift', () => {
  it('returns binary response directly and infers extension when filename is missing', async () => {
    const requestGet = vi.fn(async () =>
      makeResponse({
        ok: true,
        status: 200,
        headers: {
          'content-type': 'application/pdf',
        },
        body: Buffer.from('pdf-bytes'),
        url: 'https://eclass.yorku.ca/pluginfile.php/1/resource',
      })
    );

    const context = {
      request: { get: requestGet },
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    const result = await downloadFile(
      session as any,
      'https://eclass.yorku.ca/pluginfile.php/1/resource'
    );

    expect(result.mimeType).toBe('application/pdf');
    expect(result.filename).toBe('resource.pdf');
    expect(result.buffer.toString()).toBe('pdf-bytes');
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('throws upstream error for non-ok initial response', async () => {
    const requestGet = vi.fn(async () =>
      makeResponse({
        ok: false,
        status: 429,
        headers: {
          'content-type': 'text/plain',
        },
        body: Buffer.from('too many requests'),
        url: 'https://eclass.yorku.ca/pluginfile.php/2/rate-limit',
      })
    );

    const context = {
      request: { get: requestGet },
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    await expect(
      downloadFile(
        session as any,
        'https://eclass.yorku.ca/pluginfile.php/2/rate-limit'
      )
    ).rejects.toMatchObject({
      name: 'UpstreamError',
      code: 'RATE_LIMITED',
      httpStatus: 429,
    });

    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('resolves direct file URL from object wrapper HTML', async () => {
    const requestGet = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
          body: Buffer.from(
            '<html><body><object data="/pluginfile.php/22/doc.pdf"></object></body></html>'
          ),
          url: 'https://eclass.yorku.ca/mod/resource/view.php?id=22',
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="doc final.pdf"',
          },
          body: Buffer.from('resolved-pdf'),
          url: 'https://eclass.yorku.ca/pluginfile.php/22/doc.pdf',
        })
      );

    const context = {
      request: { get: requestGet },
      close: vi.fn(async () => undefined),
      newPage: vi.fn(async () => {
        throw new Error('newPage should not be called for object wrappers');
      }),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    const result = await downloadFile(
      session as any,
      'https://eclass.yorku.ca/mod/resource/view.php?id=22'
    );

    expect(result.filename).toBe('doc final.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.buffer.toString()).toBe('resolved-pdf');
    expect(requestGet).toHaveBeenCalledTimes(2);
  });

  it('uses network interception fallback for rendered resources', async () => {
    const requestGet = vi.fn(async () =>
      makeResponse({
        ok: true,
        status: 200,
        headers: {
          'content-type': 'text/html',
        },
        body: Buffer.from('<html><body>No direct links</body></html>'),
        url: 'https://eclass.yorku.ca/mod/resource/view.php?id=33',
      })
    );

    const responseHandlers: Array<(response: any) => Promise<void>> = [];

    const page = {
      on: vi.fn((event: string, handler: any) => {
        if (event === 'response') {
          responseHandlers.push(handler);
        }
      }),
      goto: vi.fn(async () => {
        const interceptedResponse = {
          headers: () => ({
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="slides.pptx"',
          }),
          url: () => 'https://eclass.yorku.ca/pluginfile.php/33/slides.pptx',
          body: async () => Buffer.alloc(900, 65),
        };

        for (const handler of responseHandlers) {
          await handler(interceptedResponse);
        }
      }),
      evaluate: vi.fn(async () => false),
      waitForNavigation: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    const context = {
      request: { get: requestGet },
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    const result = await downloadFile(
      session as any,
      'https://eclass.yorku.ca/mod/resource/view.php?id=33'
    );

    expect(result.filename).toBe('slides.pptx');
    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(result.buffer.length).toBe(900);
    expect(requestGet).toHaveBeenCalledTimes(1);
    expect(page.waitForLoadState).toHaveBeenCalledWith('networkidle');
    expect(page.close).toHaveBeenCalledTimes(2);
  });

  it('handles WAF challenge and resolves direct URL from rendered DOM links', async () => {
    const requestGet = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: {
            'content-type': 'text/html',
          },
          body: Buffer.from('<html><body>wrapped</body></html>'),
          url: 'https://eclass.yorku.ca/mod/resource/view.php?id=44',
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: {
            'content-type':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          body: Buffer.from('docx-bytes'),
          url: 'https://eclass.yorku.ca/pluginfile.php/44/fallback.docx',
        })
      );

    const page = {
      on: vi.fn(),
      goto: vi.fn(async () => undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce('/pluginfile.php/44/fallback.docx'),
      waitForNavigation: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const context = {
      request: { get: requestGet },
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    const result = await downloadFile(
      session as any,
      'https://eclass.yorku.ca/mod/resource/view.php?id=44'
    );

    expect(result.mimeType).toContain('wordprocessingml');
    expect(result.filename).toBe('fallback.docx');
    expect(page.waitForNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ waitUntil: 'networkidle' })
    );
    expect(page.waitForLoadState).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('WAF challenge detected')
    );
  });

  it('throws scrape layout error when HTML wrapper has no retrievable file URL', async () => {
    const requestGet = vi.fn(async () =>
      makeResponse({
        ok: true,
        status: 200,
        headers: {
          'content-type': 'text/html',
        },
        body: Buffer.from('<html><body>No direct links</body></html>'),
        url: 'https://eclass.yorku.ca/mod/resource/view.php?id=55',
      })
    );

    const page = {
      on: vi.fn(),
      goto: vi.fn(async () => undefined),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(null),
      waitForNavigation: vi.fn(async () => undefined),
      waitForLoadState: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };

    const context = {
      request: { get: requestGet },
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    await expect(
      downloadFile(
        session as any,
        'https://eclass.yorku.ca/mod/resource/view.php?id=55'
      )
    ).rejects.toBeInstanceOf(ScrapeLayoutError);

    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('maps unknown thrown errors to upstream timeout errors', async () => {
    const requestGet = vi.fn(async () => {
      throw new Error('operation timed out while fetching file');
    });

    const context = {
      request: { get: requestGet },
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    await expect(
      downloadFile(
        session as any,
        'https://eclass.yorku.ca/pluginfile.php/timeout-case'
      )
    ).rejects.toMatchObject({
      name: 'UpstreamError',
      code: 'TIMEOUT',
    });

    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('keeps upstream errors unchanged when thrown by request layer', async () => {
    const upstream = new UpstreamError('UPSTREAM_ERROR', 'boom', 502);
    const requestGet = vi.fn(async () => {
      throw upstream;
    });

    const context = {
      request: { get: requestGet },
      close: vi.fn(async () => undefined),
    };

    const session = {
      getAuthenticatedContext: vi.fn(async () => context),
    };

    await expect(
      downloadFile(
        session as any,
        'https://eclass.yorku.ca/pluginfile.php/upstream-passthrough'
      )
    ).rejects.toBe(upstream);
  });
});
