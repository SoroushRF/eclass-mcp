import { afterEach, describe, expect, it, vi } from 'vitest';
import { CengageAuthRequiredError } from '../src/scraper/cengage-errors';
import * as cengageSession from '../src/scraper/cengage-session';
import {
  getValidSessionStatePathOrThrow,
  withAuthenticatedPage,
} from '../src/scraper/cengage/navigation';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cengage navigation helpers', () => {
  it('returns state path when session validity is ok', () => {
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'C:/tmp/cengage-state.json',
      metaPath: 'C:/tmp/cengage-meta.json',
      savedAt: '2026-01-01T00:00:00.000Z',
    });

    const statePath = getValidSessionStatePathOrThrow(
      'https://www.cengage.com/dashboard/home',
      'cengage_dashboard'
    );

    expect(statePath).toBe('C:/tmp/cengage-state.json');
  });

  it('throws auth-required error when session is stale', () => {
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: false,
      reason: 'stale',
      statePath: 'C:/tmp/cengage-state.json',
      metaPath: 'C:/tmp/cengage-meta.json',
      savedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(() =>
      getValidSessionStatePathOrThrow(
        'https://www.cengage.com/dashboard/home',
        'cengage_dashboard'
      )
    ).toThrow(CengageAuthRequiredError);
  });

  it('opens authenticated context and closes it on success', async () => {
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'C:/tmp/cengage-state.json',
      metaPath: 'C:/tmp/cengage-meta.json',
      savedAt: '2026-01-01T00:00:00.000Z',
    });

    const fakePage = { marker: 'page' };
    const close = vi.fn(async () => undefined);
    const newPage = vi.fn(async () => fakePage);
    const context = { newPage, close };
    const newContext = vi.fn(async () => context);
    const browser = { newContext };

    const result = await withAuthenticatedPage({
      entryUrl: 'https://www.cengage.com/dashboard/home',
      linkType: 'cengage_dashboard',
      getBrowser: async () => browser as any,
      callback: async (page) => {
        expect(page).toBe(fakePage);
        return 'ok';
      },
    });

    expect(result).toBe('ok');
    expect(newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        storageState: 'C:/tmp/cengage-state.json',
      })
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes context even when callback fails', async () => {
    vi.spyOn(cengageSession, 'getCengageSessionValidity').mockReturnValue({
      valid: true,
      reason: 'ok',
      statePath: 'C:/tmp/cengage-state.json',
      metaPath: 'C:/tmp/cengage-meta.json',
      savedAt: '2026-01-01T00:00:00.000Z',
    });

    const close = vi.fn(async () => undefined);
    const context = {
      newPage: vi.fn(async () => ({ marker: 'page' })),
      close,
    };
    const browser = {
      newContext: vi.fn(async () => context),
    };

    await expect(
      withAuthenticatedPage({
        entryUrl: 'https://www.cengage.com/dashboard/home',
        linkType: 'cengage_dashboard',
        getBrowser: async () => browser as any,
        callback: async () => {
          throw new Error('callback failed');
        },
      })
    ).rejects.toThrow('callback failed');

    expect(close).toHaveBeenCalledTimes(1);
  });
});
