import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canonicalResourceKey: vi.fn(),
  buildContentCacheKey: vi.fn(),
  buildFileCacheKey: vi.fn(),
  buildSectionTextCacheKey: vi.fn(),
  checkPinQuota: vi.fn(),
  computePinId: vi.fn(),
  getAllPins: vi.fn(),
  getPinById: vi.fn(),
  getPinnedBytes: vi.fn(),
  getQuotaLimitBytes: vi.fn(),
  removePin: vi.fn(),
  removePinsByFilter: vi.fn(),
  upsertPin: vi.fn(),
  getCacheFilePathForKey: vi.fn(),
  getCourseContent: vi.fn(),
  getSectionText: vi.fn(),
  getFileText: vi.fn(),
  handleEclassSessionExpired: vi.fn(),
}));

vi.mock('../src/cache/pins', () => ({
  buildContentCacheKey: mocks.buildContentCacheKey,
  buildFileCacheKey: mocks.buildFileCacheKey,
  buildSectionTextCacheKey: mocks.buildSectionTextCacheKey,
  canonicalResourceKey: mocks.canonicalResourceKey,
  checkPinQuota: mocks.checkPinQuota,
  computePinId: mocks.computePinId,
  getAllPins: mocks.getAllPins,
  getPinById: mocks.getPinById,
  getPinnedBytes: mocks.getPinnedBytes,
  getQuotaLimitBytes: mocks.getQuotaLimitBytes,
  removePin: mocks.removePin,
  removePinsByFilter: mocks.removePinsByFilter,
  upsertPin: mocks.upsertPin,
}));

vi.mock('../src/cache/store', () => ({
  getCacheFilePathForKey: mocks.getCacheFilePathForKey,
}));

vi.mock('../src/tools/content', () => ({
  getCourseContent: mocks.getCourseContent,
  getSectionText: mocks.getSectionText,
}));

vi.mock('../src/tools/files', () => ({
  getFileText: mocks.getFileText,
}));

vi.mock('../src/auth/server', () => ({
  getAuthUrl: () => 'http://localhost:3000/auth',
}));

vi.mock('../src/tools/auth-retry', () => ({
  handleEclassSessionExpired: mocks.handleEclassSessionExpired,
}));

import { SessionExpiredError } from '../src/scraper/eclass';
import {
  cacheDeletePinned,
  cacheListPins,
  cachePin,
  cacheRefreshPin,
  cacheUnpin,
} from '../src/tools/pins';

function payload(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0].text || '{}');
}

const PIN = {
  pinId: 'pin-1',
  resource_type: 'file' as const,
  resource_key: 'https://eclass.yorku.ca/pluginfile.php/1/file.pdf|p2-end',
  cacheKey: 'file-cache',
  pinned_at: '2026-01-01T00:00:00.000Z',
  note: 'keep',
};

describe('pin tool layer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.canonicalResourceKey.mockImplementation((type, args) => {
      if (type === 'file') return args.fileUrl || '';
      if (type === 'sectiontext') return args.url || '';
      return args.courseId || '';
    });
    mocks.buildFileCacheKey.mockReturnValue('file-cache');
    mocks.buildSectionTextCacheKey.mockReturnValue('section-cache');
    mocks.buildContentCacheKey.mockReturnValue('content-cache');
    mocks.computePinId.mockReturnValue('pin-1');
    mocks.checkPinQuota.mockReturnValue({ ok: true });
    mocks.getPinnedBytes.mockReturnValue(123);
    mocks.getQuotaLimitBytes.mockReturnValue(456);
    mocks.getCacheFilePathForKey.mockImplementation(
      (key) => `C:/tmp/${key}.json`
    );
    mocks.getAllPins.mockReturnValue([]);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: 99 } as any);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
  });

  it('validates pin arguments for every resource type', async () => {
    expect(payload(await cachePin({ resource_type: 'file' })).reason).toBe(
      'invalid_args'
    );
    expect(
      payload(await cachePin({ resource_type: 'sectiontext' })).reason
    ).toBe('invalid_args');
    expect(payload(await cachePin({ resource_type: 'content' })).reason).toBe(
      'invalid_args'
    );
  });

  it('creates pins only when cache exists and quota allows it', async () => {
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    let result = payload(
      await cachePin({
        resource_type: 'file',
        fileUrl: 'https://eclass.yorku.ca/pluginfile.php/1/file.pdf',
      })
    );
    expect(result.reason).toBe('not_cached');

    mocks.checkPinQuota.mockReturnValueOnce({
      ok: false,
      reason: 'quota_exceeded',
      used_bytes: 100,
      would_use_bytes: 200,
      limit_bytes: 250,
    });
    result = payload(
      await cachePin({
        resource_type: 'sectiontext',
        url: 'https://eclass.yorku.ca/course/view.php?id=1&section=2',
      })
    );
    expect(result.reason).toBe('quota_exceeded');

    result = payload(
      await cachePin({
        resource_type: 'content',
        courseId: '143648',
        note: 'keep term content',
      })
    );
    expect(result.ok).toBe(true);
    expect(result.pinId).toBe('pin-1');
    expect(mocks.upsertPin).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: 'content',
        cacheKey: 'content-cache',
        note: 'keep term content',
      })
    );
  });

  it('unpins, lists, and reports pin errors', async () => {
    mocks.removePin.mockReturnValueOnce(false);
    expect(payload(await cacheUnpin({ pinId: 'missing' })).reason).toBe(
      'not_found'
    );

    mocks.removePin.mockReturnValueOnce(true);
    expect(payload(await cacheUnpin({ pinId: 'pin-1' })).removed).toBe(true);

    mocks.getAllPins.mockReturnValue([
      PIN,
      { ...PIN, pinId: 'pin-2', resource_type: 'content', cacheKey: 'content' },
    ]);
    const listed = payload(await cacheListPins({ resource_type: 'file' }));
    expect(listed.pins).toHaveLength(1);
    expect(listed.pins[0].size_bytes).toBe(99);

    vi.mocked(fs.statSync).mockImplementationOnce(() => {
      throw new Error('stat denied');
    });
    const statErrorList = payload(await cacheListPins({}));
    expect(statErrorList.pins[0].size_bytes).toBe(0);

    mocks.getAllPins.mockImplementationOnce(() => {
      throw new Error('list failed');
    });
    expect(payload(await cacheListPins({})).reason).toBe('error');
  });

  it('refreshes file, section, and content pins, including auth-required payloads', async () => {
    mocks.getPinById.mockReturnValueOnce(null);
    expect(payload(await cacheRefreshPin({ pinId: 'missing' })).reason).toBe(
      'not_found'
    );

    mocks.getPinById.mockReturnValueOnce(PIN);
    mocks.getFileText.mockResolvedValueOnce({ content: [{ text: 'ok' }] });
    expect(payload(await cacheRefreshPin({ pinId: 'pin-1' })).refreshed).toBe(
      true
    );
    expect(mocks.getFileText).toHaveBeenCalledWith(
      'unknown',
      'https://eclass.yorku.ca/pluginfile.php/1/file.pdf',
      2,
      undefined
    );

    mocks.getPinById.mockReturnValueOnce({
      ...PIN,
      resource_type: 'sectiontext',
      resource_key: 'https://eclass.yorku.ca/course/view.php?id=1&section=2',
    });
    mocks.getSectionText.mockResolvedValueOnce({ content: [{ text: 'ok' }] });
    expect(payload(await cacheRefreshPin({ pinId: 'pin-1' })).ok).toBe(true);

    mocks.getPinById.mockReturnValueOnce({
      ...PIN,
      resource_type: 'content',
      resource_key: '143648',
    });
    mocks.getCourseContent.mockResolvedValueOnce({
      content: [{ text: JSON.stringify({ status: 'auth_required' }) }],
    });
    mocks.handleEclassSessionExpired.mockResolvedValueOnce({
      content: [
        { type: 'text', text: JSON.stringify({ ok: false, handled: true }) },
      ],
    });
    expect(payload(await cacheRefreshPin({ pinId: 'pin-1' })).handled).toBe(
      true
    );

    mocks.getPinById.mockReturnValueOnce(PIN);
    mocks.getFileText.mockRejectedValueOnce(new Error('refresh failed'));
    expect(payload(await cacheRefreshPin({ pinId: 'pin-1' })).reason).toBe(
      'error'
    );
  });

  it('rejects unsafe pin creation and legacy pinned URLs', async () => {
    expect(
      payload(
        await cachePin({
          resource_type: 'file',
          fileUrl: 'https://eclass.yorku.ca.evil.test/pluginfile.php/1/a.pdf',
        })
      ).reason
    ).toBe('invalid_args');

    mocks.getPinById.mockReturnValueOnce({
      ...PIN,
      resource_key:
        'https://eclass.yorku.ca.evil.test/pluginfile.php/1/a.pdf|p1-end',
    });
    expect(payload(await cacheRefreshPin({ pinId: 'pin-1' })).reason).toBe(
      'invalid_args'
    );
    expect(mocks.getFileText).not.toHaveBeenCalled();
  });

  it('returns direct auth fallback on refresh retry attempts', async () => {
    mocks.getPinById.mockReturnValueOnce(PIN);
    mocks.getFileText.mockRejectedValueOnce(new SessionExpiredError('expired'));

    const result = payload(await cacheRefreshPin({ pinId: 'pin-1' }, true));

    expect(result.reason).toBe('session_expired');
    expect(result.retry.authUrl).toBe('http://localhost:3000/auth');
  });

  it('deletes pinned cache files by id, all pins, or resource type', async () => {
    mocks.getPinById.mockReturnValueOnce(null);
    expect(payload(await cacheDeletePinned({ pinId: 'missing' })).reason).toBe(
      'not_found'
    );

    mocks.getPinById.mockReturnValueOnce(PIN);
    expect(payload(await cacheDeletePinned({ pinId: 'pin-1' }))).toMatchObject({
      ok: true,
      removed_pins: 1,
      removed_cache_files: 1,
    });

    mocks.getAllPins.mockReturnValueOnce([PIN, { ...PIN, pinId: 'pin-2' }]);
    mocks.removePinsByFilter.mockReturnValueOnce([
      PIN,
      { ...PIN, pinId: 'pin-2' },
    ]);
    expect(payload(await cacheDeletePinned({ mode: 'all' }))).toMatchObject({
      removed_pins: 2,
      removed_cache_files: 2,
    });

    mocks.removePinsByFilter.mockReturnValueOnce([PIN]);
    expect(
      payload(
        await cacheDeletePinned({ mode: 'by_type', resource_type: 'file' })
      )
    ).toMatchObject({
      removed_pins: 1,
      removed_cache_files: 1,
      resource_type: 'file',
    });

    expect(payload(await cacheDeletePinned({ mode: 'by_type' })).reason).toBe(
      'invalid_args'
    );

    mocks.getAllPins.mockImplementationOnce(() => {
      throw new Error('delete failed');
    });
    expect(payload(await cacheDeletePinned({ mode: 'all' })).reason).toBe(
      'error'
    );
  });
});
