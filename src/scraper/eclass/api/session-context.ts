import type {
  APIRequestContext,
  BrowserContext,
  Page,
} from 'playwright';
import {
  clearActiveEclassAccountScope,
  setActiveEclassAccountScope,
} from '../../../cache/account-scope';
import { checkSession } from '../helpers';
import {
  ECLASS_DEFAULT_ORIGIN,
  getEclassApiConfig,
} from './constants';

export interface EclassBrowserSessionLike {
  getAuthenticatedContext(): Promise<BrowserContext>;
}

export interface EclassApiSession {
  context: BrowserContext;
  request: APIRequestContext;
  sesskey: string;
  userId: string;
  accountScope: string;
  createdAt: string;
}

export interface EclassApiSessionContextOptions {
  browserSession: EclassBrowserSessionLike;
  origin?: string;
  bootstrapPath?: string;
  timeoutMs?: number;
}

interface MoodleRuntimeConfig {
  sesskey?: unknown;
  userId?: unknown;
  wwwroot?: unknown;
}

const activeSessionContexts = new Set<EclassApiSessionContext>();

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Authenticated eClass bootstrap did not expose ${field}.`);
  }
  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`Authenticated eClass bootstrap did not expose ${field}.`);
  }
  return normalized;
}

async function readMoodleRuntimeConfig(
  page: Page
): Promise<MoodleRuntimeConfig> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      M?: { cfg?: MoodleRuntimeConfig };
    };
    return {
      sesskey: runtime.M?.cfg?.sesskey,
      userId: runtime.M?.cfg?.userId,
      wwwroot: runtime.M?.cfg?.wwwroot,
    };
  });
}

export class EclassApiSessionContext {
  private readonly browserSession: EclassBrowserSessionLike;
  private readonly origin: string;
  private readonly bootstrapPath: string;
  private readonly timeoutMs: number;
  private session: EclassApiSession | null = null;
  private bootstrapPromise: Promise<EclassApiSession> | null = null;

  constructor(options: EclassApiSessionContextOptions) {
    this.browserSession = options.browserSession;
    this.origin = options.origin ?? getEclassApiConfig().origin;
    this.bootstrapPath = options.bootstrapPath ?? '/my/';
    this.timeoutMs = options.timeoutMs ?? getEclassApiConfig().timeoutMs;
    activeSessionContexts.add(this);
  }

  async getSession(): Promise<EclassApiSession> {
    if (this.session) return this.session;
    if (this.bootstrapPromise) return this.bootstrapPromise;

    const promise = this.bootstrap();
    this.bootstrapPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.bootstrapPromise === promise) {
        this.bootstrapPromise = null;
      }
    }
  }

  async refresh(): Promise<EclassApiSession> {
    const current = this.session;
    this.session = null;

    const pending = this.bootstrapPromise;
    this.bootstrapPromise = null;
    if (pending) {
      try {
        const pendingSession = await pending;
        if (pendingSession !== current) {
          if (this.session === pendingSession) {
            this.session = null;
          }
          await this.closeSession(pendingSession);
        }
      } catch {
        // The pending bootstrap's caller receives its original error.
      }
    }

    if (current) {
      await this.closeSession(current);
    }

    return this.getSession();
  }

  async close(): Promise<void> {
    const pending = this.bootstrapPromise;
    this.bootstrapPromise = null;
    if (pending) {
      try {
        await pending;
      } catch {
        // Preserve cleanup guarantees when bootstrap itself failed.
      }
    }

    const current = this.session;
    this.session = null;
    if (current) {
      await this.closeSession(current);
    }
    activeSessionContexts.delete(this);
  }

  private async bootstrap(): Promise<EclassApiSession> {
    const context = await this.browserSession.getAuthenticatedContext();
    let session: EclassApiSession | null = null;
    let page: Page | null = null;

    try {
      page = await context.newPage();
      await page.goto(new URL(this.bootstrapPath, this.origin).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });
      await checkSession(page);

      const runtime = await readMoodleRuntimeConfig(page);
      const sesskey = assertNonEmptyString(runtime.sesskey, 'M.cfg.sesskey');
      const userId = assertNonEmptyString(runtime.userId, 'M.cfg.userId');
      const wwwroot =
        typeof runtime.wwwroot === 'string'
          ? runtime.wwwroot.trim()
          : ECLASS_DEFAULT_ORIGIN;

      if (!wwwroot) {
        throw new Error(
          'Authenticated eClass bootstrap did not expose M.cfg.wwwroot.'
        );
      }

      const accountScope = setActiveEclassAccountScope(this.origin, userId);
      session = {
        context,
        request: context.request,
        sesskey,
        userId,
        accountScope,
        createdAt: new Date().toISOString(),
      };
      this.session = session;
      return session;
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
      if (!session) {
        await context.close().catch(() => undefined);
      }
    }
  }

  private async closeSession(session: EclassApiSession): Promise<void> {
    clearActiveEclassAccountScope(session.accountScope);
    await session.context.close().catch(() => undefined);
  }
}

export async function closeAllEclassApiSessionContexts(): Promise<void> {
  await Promise.all(
    Array.from(activeSessionContexts, (sessionContext) =>
      sessionContext.close()
    )
  );
}
