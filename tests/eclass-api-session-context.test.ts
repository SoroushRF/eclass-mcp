import type { APIRequestContext, BrowserContext, Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearActiveEclassAccountScope } from '../src/cache/account-scope';
import { SessionExpiredError } from '../src/scraper/session';
import { EclassApiSessionContext } from '../src/scraper/eclass/api/session-context';

const originalSessionSecret = process.env.ECLASS_MCP_SESSION_SECRET;

beforeEach(() => {
  process.env.ECLASS_MCP_SESSION_SECRET = 'x'.repeat(32);
});

afterEach(() => {
  clearActiveEclassAccountScope();
  if (originalSessionSecret === undefined) {
    delete process.env.ECLASS_MCP_SESSION_SECRET;
  } else {
    process.env.ECLASS_MCP_SESSION_SECRET = originalSessionSecret;
  }
});

interface FakeContext {
  newPage: ReturnType<typeof vi.fn>;
  request: APIRequestContext;
  close: ReturnType<typeof vi.fn>;
}

function createBootstrapFixture(options?: {
  url?: string;
  runtime?: Record<string, unknown>;
}) {
  const page = {
    url: vi.fn(() => options?.url ?? 'https://eclass.yorku.ca/my/'),
    evaluate: vi
      .fn()
      .mockResolvedValueOnce({
        title: 'My courses',
        hasPasswordInput: false,
        hasLoginForm: false,
        hasPassportYorkMarker: false,
        bodyTextSnippet: 'My courses',
      })
      .mockResolvedValueOnce(
        options?.runtime ?? {
          sesskey: 'ephemeral-sesskey',
          userId: 42,
          wwwroot: 'https://eclass.yorku.ca',
        }
      ),
    goto: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  } satisfies Partial<Page>;

  const context: FakeContext = {
    newPage: vi.fn(async () => page),
    request: {} as APIRequestContext,
    close: vi.fn(async () => undefined),
  };

  return {
    page,
    context,
    browserSession: {
      getAuthenticatedContext: vi.fn(
        async () => context as unknown as BrowserContext
      ),
    },
  };
}

describe('EclassApiSessionContext', () => {
  it('bootstraps an authenticated session once and keeps sesskey in memory', async () => {
    const fixture = createBootstrapFixture();
    const sessionContext = new EclassApiSessionContext({
      browserSession: fixture.browserSession,
      timeoutMs: 5000,
    });

    const [first, second] = await Promise.all([
      sessionContext.getSession(),
      sessionContext.getSession(),
    ]);

    expect(first).toBe(second);
    expect(first).toMatchObject({
      request: fixture.context.request,
      sesskey: 'ephemeral-sesskey',
      userId: '42',
    });
    expect(fixture.browserSession.getAuthenticatedContext).toHaveBeenCalledTimes(
      1
    );
    expect(fixture.page.goto).toHaveBeenCalledWith(
      'https://eclass.yorku.ca/my/',
      expect.objectContaining({
        waitUntil: 'domcontentloaded',
        timeout: 5000,
      })
    );
    expect(fixture.page.close).toHaveBeenCalledTimes(1);
    expect(fixture.context.close).not.toHaveBeenCalled();

    await sessionContext.close();
    expect(fixture.context.close).toHaveBeenCalledTimes(1);
  });

  it('turns a missing saved session into the existing expiry error', async () => {
    const browserSession = {
      getAuthenticatedContext: vi.fn(async () => {
        throw new SessionExpiredError();
      }),
    };
    const sessionContext = new EclassApiSessionContext({ browserSession });

    await expect(sessionContext.getSession()).rejects.toBeInstanceOf(
      SessionExpiredError
    );
  });

  it('closes the context when the page is an authentication page', async () => {
    const fixture = createBootstrapFixture({
      url: 'https://eclass.yorku.ca/login/index.php',
    });
    const sessionContext = new EclassApiSessionContext({
      browserSession: fixture.browserSession,
    });

    await expect(sessionContext.getSession()).rejects.toBeInstanceOf(
      SessionExpiredError
    );
    expect(fixture.page.close).toHaveBeenCalledTimes(1);
    expect(fixture.context.close).toHaveBeenCalledTimes(1);
  });

  it('closes the context when sesskey or user id is missing', async () => {
    const fixture = createBootstrapFixture({
      runtime: {
        sesskey: '',
        userId: 42,
        wwwroot: 'https://eclass.yorku.ca',
      },
    });
    const sessionContext = new EclassApiSessionContext({
      browserSession: fixture.browserSession,
    });

    await expect(sessionContext.getSession()).rejects.toThrow(/sesskey/);
    expect(fixture.context.close).toHaveBeenCalledTimes(1);
  });

  it('refreshes the in-memory session and closes the old context once', async () => {
    const first = createBootstrapFixture();
    const second = createBootstrapFixture({
      runtime: {
        sesskey: 'new-sesskey',
        userId: 42,
        wwwroot: 'https://eclass.yorku.ca',
      },
    });
    const getAuthenticatedContext = vi
      .fn()
      .mockResolvedValueOnce(first.context as unknown as BrowserContext)
      .mockResolvedValueOnce(second.context as unknown as BrowserContext);
    const sessionContext = new EclassApiSessionContext({
      browserSession: { getAuthenticatedContext },
    });

    const oldSession = await sessionContext.getSession();
    const newSession = await sessionContext.refresh();

    expect(oldSession.sesskey).toBe('ephemeral-sesskey');
    expect(newSession.sesskey).toBe('new-sesskey');
    expect(first.context.close).toHaveBeenCalledTimes(1);
    expect(second.context.close).not.toHaveBeenCalled();

    await sessionContext.close();
    expect(second.context.close).toHaveBeenCalledTimes(1);
  });
});
