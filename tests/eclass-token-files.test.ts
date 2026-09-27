import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import { EclassHybridProvider } from '../src/scraper/eclass/api/hybrid';
import {
  downloadFileWithToken,
  toWebservicePluginfileUrl,
} from '../src/scraper/eclass/api/token-files';
import {
  RESPONSE_TOO_LARGE,
  type FetchLike,
} from '../src/scraper/eclass/api/transport';
import { rootLogger } from '../src/logging/logger';
import type { EclassScraperDependency } from '../src/tools/dependencies';

const ORIGIN = 'https://eclass.yorku.ca';
const TOKEN = '0123456789abcdef0123456789abcdef';
const FILE_URL = `${ORIGIN}/pluginfile.php/123/mod_resource/content/1/Lecture%201.pdf?forcedownload=1`;

function captureLogs() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(JSON.stringify(args));
  };
  vi.spyOn(rootLogger, 'info').mockImplementation(record as never);
  vi.spyOn(rootLogger, 'warn').mockImplementation(record as never);
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('token file URL mapping', () => {
  it('maps pluginfile URLs to the web service form without a token', () => {
    expect(toWebservicePluginfileUrl(FILE_URL)).toBe(
      `${ORIGIN}/webservice/pluginfile.php/123/mod_resource/content/1/Lecture%201.pdf?forcedownload=1`
    );
    expect(
      toWebservicePluginfileUrl(
        `${ORIGIN}/webservice/pluginfile.php/1/a.pdf?token=stale&wstoken=old`
      )
    ).toBe(`${ORIGIN}/webservice/pluginfile.php/1/a.pdf`);
  });

  it('returns null for wrapper pages and rejects off-policy URLs', () => {
    expect(
      toWebservicePluginfileUrl(`${ORIGIN}/mod/resource/view.php?id=5`)
    ).toBeNull();
    expect(() =>
      toWebservicePluginfileUrl('https://evil.example/pluginfile.php/1/a.pdf')
    ).toThrow();
    expect(() =>
      toWebservicePluginfileUrl('http://eclass.yorku.ca/pluginfile.php/1/a')
    ).toThrow();
  });
});

describe('downloadFileWithToken', () => {
  it('appends the token only to the request URL and never logs it', async () => {
    const logs = captureLogs();
    const fetchImpl = vi.fn<FetchLike>(
      async () =>
        new Response(Buffer.from('%PDF-1.7 fake'), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline; filename="Lecture 1.pdf"',
          },
        })
    );

    const file = await downloadFileWithToken(FILE_URL, TOKEN, { fetchImpl });

    expect(file).toMatchObject({
      mimeType: 'application/pdf',
      filename: 'Lecture 1.pdf',
    });
    expect(file.buffer.toString()).toBe('%PDF-1.7 fake');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(new URL(url).pathname).toBe(
      '/webservice/pluginfile.php/123/mod_resource/content/1/Lecture%201.pdf'
    );
    expect(new URL(url).searchParams.get('token')).toBe(TOKEN);
    expect(init.redirect).toBe('error');
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('does not call fetch for off-policy URLs or wrapper pages', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(
      downloadFileWithToken('https://evil.example/pluginfile.php/1', TOKEN, {
        fetchImpl,
      })
    ).rejects.toThrow();
    await expect(
      downloadFileWithToken(`${ORIGIN}/mod/resource/view.php?id=1`, TOKEN, {
        fetchImpl,
      })
    ).rejects.toMatchObject({ category: 'capability_unavailable' });
    await expect(
      downloadFileWithToken(FILE_URL, ' ', { fetchImpl })
    ).rejects.toMatchObject({ category: 'mobile_token_invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies error envelopes, HTML, size caps, and HTTP errors', async () => {
    captureLogs();
    const respond = (body: string, init: ResponseInit) =>
      vi.fn<FetchLike>(async () => new Response(body, init));

    await expect(
      downloadFileWithToken(FILE_URL, TOKEN, {
        fetchImpl: respond(
          JSON.stringify({ errorcode: 'invalidtoken', exception: 'x' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
      })
    ).rejects.toMatchObject({ category: 'mobile_token_invalid' });

    await expect(
      downloadFileWithToken(FILE_URL, TOKEN, {
        fetchImpl: respond('<html>login</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      })
    ).rejects.toMatchObject({ category: 'capability_unavailable' });

    await expect(
      downloadFileWithToken(FILE_URL, TOKEN, {
        maxBytes: 10,
        fetchImpl: respond('x'.repeat(100), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        }),
      })
    ).rejects.toMatchObject({ category: 'malformed_response' });

    await expect(
      downloadFileWithToken(FILE_URL, TOKEN, {
        fetchImpl: respond('', { status: 429 }),
      })
    ).rejects.toMatchObject({ category: 'rate_limited' });

    const error = await downloadFileWithToken(FILE_URL, TOKEN, {
      fetchImpl: async (url) => {
        throw new TypeError(`network error at ${url}`);
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MoodleApiError);
    expect(JSON.stringify(error) + String(error)).not.toContain(TOKEN);
  });
});

describe('hybrid provider file downloads', () => {
  function playwright(): EclassScraperDependency {
    return {
      downloadFile: vi.fn(async () => ({
        buffer: Buffer.from('html'),
        mimeType: 'application/pdf',
        filename: 'playwright.pdf',
      })),
    } as unknown as EclassScraperDependency;
  }

  it('prefers the token download when it applies', async () => {
    const html = playwright();
    const provider = new EclassHybridProvider({
      playwright: html,
      mode: 'api',
      origin: ORIGIN,
      tokenFiles: {
        download: vi.fn(async () => ({
          buffer: Buffer.from('token'),
          mimeType: 'application/pdf',
          filename: 'token.pdf',
        })),
      },
    });

    await expect(provider.downloadFile(FILE_URL)).resolves.toMatchObject({
      filename: 'token.pdf',
    });
    expect(html.downloadFile).not.toHaveBeenCalled();
  });

  it('falls back to Playwright when the token path is absent or fails', async () => {
    captureLogs();
    const html = playwright();
    const notApplicable = new EclassHybridProvider({
      playwright: html,
      mode: 'api',
      origin: ORIGIN,
      tokenFiles: { download: vi.fn(async () => null) },
    });
    await expect(notApplicable.downloadFile(FILE_URL)).resolves.toMatchObject({
      filename: 'playwright.pdf',
    });

    const failing = new EclassHybridProvider({
      playwright: html,
      mode: 'api',
      origin: ORIGIN,
      tokenFiles: {
        download: vi.fn(async () => {
          throw new MoodleApiError({ category: 'mobile_token_invalid' });
        }),
      },
    });
    await expect(failing.downloadFile(FILE_URL)).resolves.toMatchObject({
      filename: 'playwright.pdf',
    });
    expect(html.downloadFile).toHaveBeenCalledTimes(2);
  });

  it('sends no token traffic in playwright mode', async () => {
    const html = playwright();
    const download = vi.fn(async () => ({
      buffer: Buffer.from('token'),
      mimeType: 'application/pdf',
      filename: 'token.pdf',
    }));
    const provider = new EclassHybridProvider({
      playwright: html,
      mode: 'playwright',
      origin: ORIGIN,
      tokenFiles: { download },
    });

    await expect(provider.downloadFile(FILE_URL)).resolves.toMatchObject({
      filename: 'playwright.pdf',
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('surfaces a rate limit or size cap instead of retrying in the browser', async () => {
    const html = playwright();
    for (const error of [
      new MoodleApiError({ category: 'rate_limited' }),
      new MoodleApiError({
        category: 'upstream',
        upstreamCode: RESPONSE_TOO_LARGE,
      }),
    ]) {
      const provider = new EclassHybridProvider({
        playwright: html,
        mode: 'api',
        origin: ORIGIN,
        tokenFiles: {
          download: vi.fn(async () => {
            throw error;
          }),
        },
      });
      await expect(provider.downloadFile(FILE_URL)).rejects.toBe(error);
    }
    expect(html.downloadFile).not.toHaveBeenCalled();
  });
});
