import { afterEach, describe, expect, it, vi } from 'vitest';
import siteInfoFixture from './fixtures/eclass-api/rest-site-info.json';
import {
  clearActiveEclassAccountScope,
  deriveEclassAccountScope,
  getActiveEclassAccountScope,
  setActiveEclassAccountScope,
} from '../src/cache/account-scope';
import * as session from '../src/scraper/session';
import {
  closeDefaultEclassHybridProvider,
  ensureEclassAccountScope,
} from '../src/tools/dependencies';

const ORIGIN = 'https://eclass.yorku.ca';

function fakeCredential(token: string): session.MobileCredential {
  return {
    service: 'moodle_mobile_app',
    token,
    issuedAt: '2026-09-27T00:00:00.000Z',
  };
}

function siteInfoFetch(users: Record<string, number>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const token = new URLSearchParams(String(init?.body)).get('wstoken');
    const userid = token ? users[token] : undefined;
    const body =
      userid === undefined
        ? { errorcode: 'invalidtoken', exception: 'x', message: 'x' }
        : { ...siteInfoFixture, userid };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(async () => {
  await closeDefaultEclassHybridProvider();
  clearActiveEclassAccountScope();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('token-derived account scope', () => {
  it('leaves the browser-derived scope alone outside api mode', async () => {
    vi.stubEnv('ECLASS_API_SOURCE_MODE', 'shadow');
    const fetch = siteInfoFetch({});
    vi.stubGlobal('fetch', fetch);
    setActiveEclassAccountScope(ORIGIN, 5);

    await ensureEclassAccountScope();

    expect(fetch).not.toHaveBeenCalled();
    expect(getActiveEclassAccountScope()).toBe(
      deriveEclassAccountScope(ORIGIN, 5)
    );
  });

  it('scopes caches to the verified token identity and follows a swap', async () => {
    vi.stubEnv('ECLASS_API_SOURCE_MODE', 'api');
    const fetch = siteInfoFetch({ 'fake-token-a': 7, 'fake-token-b': 9 });
    vi.stubGlobal('fetch', fetch);
    let active = fakeCredential('fake-token-a');
    vi.spyOn(session, 'loadMobileCredential').mockImplementation(() => active);

    await ensureEclassAccountScope();
    expect(getActiveEclassAccountScope()).toBe(
      deriveEclassAccountScope(ORIGIN, 7)
    );
    await ensureEclassAccountScope();
    expect(fetch).toHaveBeenCalledTimes(1);

    active = fakeCredential('fake-token-b');
    await ensureEclassAccountScope();
    expect(getActiveEclassAccountScope()).toBe(
      deriveEclassAccountScope(ORIGIN, 9)
    );
  });

  it('clears the scope when the token cannot be verified', async () => {
    vi.stubEnv('ECLASS_API_SOURCE_MODE', 'api');
    vi.stubGlobal('fetch', siteInfoFetch({}));
    vi.spyOn(session, 'loadMobileCredential').mockReturnValue(
      fakeCredential('fake-token-revoked')
    );
    vi.spyOn(session, 'clearMobileCredential').mockImplementation(() => {});
    // Renewal needs cookies; none are stored, so no browser starts.
    const loadSession = vi.spyOn(session, 'loadSession').mockReturnValue(null);
    setActiveEclassAccountScope(ORIGIN, 5);

    await ensureEclassAccountScope();

    expect(getActiveEclassAccountScope()).toBeNull();
    expect(loadSession).toHaveBeenCalled();
  });
});
