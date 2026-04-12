import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { cache, getCacheKey } from '../src/cache/store';
import { scraper, SessionExpiredError } from '../src/scraper/eclass';
import { getItemDetails } from '../src/tools/deadlines';

const touchedCacheKeys = new Set<string>();

function detailsCacheKey(url: string): string {
  const shortened = url.length > 150 ? url.slice(-150) : url;
  return getCacheKey('details', 'v2', shortened);
}

function rememberDetailsKey(url: string): string {
  const key = detailsCacheKey(url);
  touchedCacheKeys.add(key);
  return key;
}

function parseMeta(result: { content: Array<{ text?: string }> }): any {
  return JSON.parse(result.content[0].text || '{}');
}

afterEach(() => {
  for (const key of touchedCacheKeys) {
    cache.invalidate(key);
  }
  touchedCacheKeys.clear();
  vi.restoreAllMocks();
});

describe('deadlines getItemDetails media and csv branches', () => {
  it('returns cached item details payload when media flags are disabled', async () => {
    const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=cache-1';
    rememberDetailsKey(url);

    const scraperSpy = vi.spyOn(scraper, 'getItemDetails').mockResolvedValue({
      kind: 'assign',
      url,
      title: 'Assignment 1',
      descriptionText: 'Read chapter 1',
    } as any);

    const first = parseMeta(await getItemDetails({ url }));
    expect(first.kind).toBe('assign');
    expect(first._cache.hit).toBe(false);

    const second = parseMeta(await getItemDetails({ url }));
    expect(second.kind).toBe('assign');
    expect(second._cache.hit).toBe(true);
    expect(scraperSpy).toHaveBeenCalledTimes(1);
  });

  it('inlines csv preview blocks and reports skipped csv downloads', async () => {
    const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=csv-1';
    rememberDetailsKey(url);

    vi.spyOn(scraper, 'getItemDetails').mockResolvedValue({
      kind: 'assign',
      url,
      title: 'Assignment with CSV',
      attachments: [
        {
          kind: 'csv',
          url: 'https://eclass.yorku.ca/pluginfile.php/1/a.csv',
          name: 'grades-a.csv',
        },
        {
          kind: 'csv',
          url: 'https://eclass.yorku.ca/pluginfile.php/1/b.csv',
          name: 'grades-b.csv',
        },
        {
          kind: 'pdf',
          url: 'https://eclass.yorku.ca/pluginfile.php/1/rubric.pdf',
          name: 'rubric.pdf',
        },
      ],
    } as any);

    vi.spyOn(scraper, 'downloadFile').mockImplementation(
      async (downloadUrl) => {
        if (downloadUrl.includes('/a.csv')) {
          return {
            buffer: Buffer.from(
              '\uFEFFcol1,col2\n1,2\n3,4\n5,6\u0000',
              'utf-8'
            ),
            mimeType: 'text/csv',
            filename: 'a.csv',
          } as any;
        }

        throw new Error('simulated csv download failure');
      }
    );

    const result = await getItemDetails({
      url,
      includeCsv: true,
      csvMode: 'preview',
      csvPreviewLines: 2,
      maxCsvBytes: 200,
      maxCsvAttachments: 3,
    });

    const meta = parseMeta(result);
    expect(meta.csvTotalAttachments).toBe(2);
    expect(meta.csvIncludedCount).toBe(1);
    expect(meta.csvSkippedCount).toBe(1);

    const csvBlock = result.content.find(
      (block) => block.text && block.text.includes('--- CSV:')
    );
    expect(csvBlock?.text).toContain('--- CSV: grades-a.csv ---');
    expect(csvBlock?.text).toContain('col1,col2\n1,2');
    expect(csvBlock?.text).not.toContain('3,4');
    expect(csvBlock?.text?.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('downgrades full csv mode to preview when csv is larger than maxCsvBytes', async () => {
    const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=csv-2';
    rememberDetailsKey(url);

    vi.spyOn(scraper, 'getItemDetails').mockResolvedValue({
      kind: 'assign',
      url,
      title: 'Large CSV',
      attachments: [
        {
          kind: 'csv',
          url: 'https://eclass.yorku.ca/pluginfile.php/2/large.csv',
          name: 'large.csv',
        },
      ],
    } as any);

    vi.spyOn(scraper, 'downloadFile').mockResolvedValue({
      buffer: Buffer.from(
        'h1,h2\n111111,222222\n333333,444444\n555555,666666',
        'utf-8'
      ),
      mimeType: 'text/csv',
      filename: 'large.csv',
    } as any);

    const result = await getItemDetails({
      url,
      includeCsv: true,
      csvMode: 'full',
      maxCsvBytes: 16,
      csvPreviewLines: 10,
    });

    const meta = parseMeta(result);
    expect(meta.csvIncludedCount).toBe(1);

    const csvText =
      result.content.find((block) => block.text?.includes('--- CSV:'))?.text ||
      '';
    expect(csvText).toContain('--- CSV: large.csv ---');
    expect(csvText.length).toBeLessThan(80);
  });

  it('returns early metadata when includeImages is enabled but no images exist', async () => {
    const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=img-none';
    rememberDetailsKey(url);

    vi.spyOn(scraper, 'getItemDetails').mockResolvedValue({
      kind: 'assign',
      url,
      title: 'No images',
      descriptionText: 'Text only',
    } as any);

    const result = await getItemDetails({ url, includeImages: true });
    const meta = parseMeta(result);

    expect(meta.imageTotalCount).toBe(0);
    expect(meta.imagesReturnedCount).toBe(0);
    expect(meta.imagesSkippedByBudget).toBe(0);
    expect(meta.note).toContain('No instruction images found');
    expect(result.content).toHaveLength(1);
  });

  it('inlines images with type filtering, budget controls, and offset normalization', async () => {
    const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=img-mixed';
    rememberDetailsKey(url);

    vi.spyOn(scraper, 'getItemDetails').mockResolvedValue({
      kind: 'assign',
      url,
      title: 'Image test',
      descriptionImageUrls: [
        'https://cdn.example.com/not-image.bin',
        'https://cdn.example.com/image-1.png',
        'https://cdn.example.com/image-2.jpg?token=abc',
        'https://cdn.example.com/fail.webp',
        'https://cdn.example.com/large.png',
      ],
    } as any);

    vi.spyOn(scraper, 'downloadFile').mockImplementation(
      async (downloadUrl) => {
        if (downloadUrl.includes('not-image.bin')) {
          return {
            buffer: Buffer.from('bin'),
            mimeType: 'application/octet-stream',
            filename: 'not-image.bin',
          } as any;
        }
        if (downloadUrl.includes('image-1.png')) {
          return {
            buffer: Buffer.from('123'),
            mimeType: 'image/png',
            filename: 'image-1.png',
          } as any;
        }
        if (downloadUrl.includes('image-2.jpg')) {
          return {
            buffer: Buffer.from('456'),
            mimeType: 'application/octet-stream',
            filename: 'image-2.jpg',
          } as any;
        }
        if (downloadUrl.includes('fail.webp')) {
          throw new Error('simulated image failure');
        }
        if (downloadUrl.includes('large.png')) {
          return {
            buffer: Buffer.alloc(200, 70),
            mimeType: 'image/png',
            filename: 'large.png',
          } as any;
        }
        throw new Error('unexpected image URL');
      }
    );

    const result = await getItemDetails({
      url,
      includeImages: true,
      imageOffset: -4,
      maxImages: 5,
      maxTotalImageBytes: 150,
    });

    const meta = parseMeta(result);
    expect(meta.imageTotalCount).toBe(5);
    expect(meta.imageOffset).toBe(0);
    expect(meta.imagesReturnedCount).toBe(2);
    expect(meta.imagesSkippedByBudget).toBe(3);
    expect(meta.imagesRemainingCount).toBe(0);
    expect(meta.nextImageOffset).toBe(5);
    expect(meta.usedBase64BytesEstimate).toBeGreaterThan(0);

    const imageBlocks = result.content.filter(
      (block: any) => block.type === 'image'
    );
    expect(imageBlocks).toHaveLength(2);
    expect(
      imageBlocks.every((block: any) => typeof block.data === 'string')
    ).toBe(true);
  });

  it('maps SessionExpiredError to auth_required for getItemDetails', async () => {
    const url = 'https://eclass.yorku.ca/mod/assign/view.php?id=auth-1';
    rememberDetailsKey(url);

    vi.spyOn(scraper, 'getItemDetails').mockRejectedValue(
      new SessionExpiredError('session expired')
    );
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );

    const result = await getItemDetails({ url, includeImages: true });
    const payload = parseMeta(result);

    expect(payload.status).toBe('auth_required');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry?.authUrl).toBe('http://localhost:3000/auth');
    expect(openAuthSpy).toHaveBeenCalledTimes(1);
  });
});
