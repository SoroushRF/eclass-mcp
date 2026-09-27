import {
  scraper as defaultEClassScraper,
  type EClassScraper,
} from '../scraper/eclass';
import { EClassBrowserSession } from '../scraper/eclass/browser-session';
import { EclassApiSessionContext } from '../scraper/eclass/api/session-context';
import { MoodleAjaxClient } from '../scraper/eclass/api/client';
import {
  EclassHybridProvider,
  type EclassHybridProviderOptions,
} from '../scraper/eclass/api/hybrid';
import { getEclassApiConfig } from '../scraper/eclass/api/constants';
import { MoodleMobileLauncher } from '../scraper/eclass/api/mobile';
import { MoodleRestClient } from '../scraper/eclass/api/rest';
import { FetchMoodleRestTransport } from '../scraper/eclass/api/transport';
import {
  downloadFileWithToken,
  toWebservicePluginfileUrl,
} from '../scraper/eclass/api/token-files';
import {
  getAuthGeneration,
  isSessionValid,
  loadMobileCredential,
  saveMobileCredentialForGeneration,
} from '../scraper/session';
import {
  clearActiveEclassAccountScope,
  setActiveEclassAccountScope,
} from '../cache/account-scope';
import { RMPClient } from '../scraper/rmp';
import { SISScraper } from '../scraper/sis';
import { CengageScraper } from '../scraper/cengage';

export type EclassScraperDependency = Pick<
  EClassScraper,
  | 'getCourses'
  | 'getCourseContent'
  | 'getDeadlines'
  | 'getAllAssignmentDeadlines'
  | 'getItemDetails'
  | 'getAssignmentSubmissionPreflight'
  | 'downloadFile'
  | 'getSectionText'
  | 'getGrades'
  | 'getAnnouncements'
>;

export type SisScraperDependency = Pick<
  SISScraper,
  'scrapeExams' | 'scrapeTimetable'
>;

export type RmpClientDependency = Pick<
  RMPClient,
  'searchTeachersWithDiagnostics' | 'getTeacherDetails'
>;

export type CengageScraperDependency = CengageScraper;

export interface ToolDependencies {
  eclassScraper: EclassScraperDependency;
  createSisScraper: () => SisScraperDependency;
  createRmpClient: () => RmpClientDependency;
  createCengageScraper: () => CengageScraperDependency;
}

let defaultHybridProvider: EclassHybridProvider | null = null;
let defaultRestClient: MoodleRestClient | null = null;

function storedMobileCredentialPresent(): boolean {
  try {
    return loadMobileCredential() !== null;
  } catch {
    return false;
  }
}

/**
 * A stored token, or a renewal in flight for the current login. During
 * renewal the old token is already cleared, but reads should still route to
 * REST and wait for the new token rather than skip it.
 */
export function hasUsableMobileCredential(): boolean {
  if (storedMobileCredentialPresent()) return true;
  return defaultRestClient?.hasPendingRenewal() ?? false;
}

export function getDefaultEclassHybridProvider(): EclassHybridProvider {
  if (defaultHybridProvider) return defaultHybridProvider;

  const config = getEclassApiConfig();
  const browserSession = new EClassBrowserSession();
  const apiSessionContext = new EclassApiSessionContext({
    browserSession,
    origin: config.origin,
    timeoutMs: config.timeoutMs,
  });
  // Token REST reads (ADR 0011). A rejected token re-mints once through the
  // cookie session; without a stored credential REST is skipped entirely.
  // The renewal saves only if no login or logout happened since it started.
  const restClient = new MoodleRestClient({
    transport: new FetchMoodleRestTransport({
      origin: config.origin,
      timeoutMs: config.timeoutMs,
    }),
    reMint: () => {
      const generation = getAuthGeneration();
      return new MoodleMobileLauncher({
        sessionContext: apiSessionContext,
        origin: config.origin,
        timeoutMs: config.timeoutMs,
        credentialStore: {
          save: (credential) =>
            saveMobileCredentialForGeneration(credential, generation),
        },
      }).launch();
    },
    onIdentity: (userId) => setScopeFromVerifiedUser(config.origin, userId),
  });
  defaultRestClient = restClient;
  const options: EclassHybridProviderOptions = {
    playwright: defaultEClassScraper,
    tokenFiles: {
      download: async (fileUrl) => {
        if (!toWebservicePluginfileUrl(fileUrl)) return null;
        if (!hasUsableMobileCredential()) return null;
        const { value } = await restClient.withCredential((token) =>
          downloadFileWithToken(fileUrl, token)
        );
        return value;
      },
    },
    apiClient: new MoodleAjaxClient({
      sessionContext: apiSessionContext,
      origin: config.origin,
      timeoutMs: config.timeoutMs,
    }),
    restClient,
    hasMobileCredential: hasUsableMobileCredential,
    hasCookieSession: () => {
      try {
        return isSessionValid();
      } catch {
        return false;
      }
    },
    apiSessionContext,
    closeOwnedResources: () => browserSession.close(),
    mode: config.sourceMode,
    origin: config.origin,
  };
  defaultHybridProvider = new EclassHybridProvider(options);
  return defaultHybridProvider;
}

export async function closeDefaultEclassHybridProvider(): Promise<void> {
  const provider = defaultHybridProvider;
  defaultHybridProvider = null;
  defaultRestClient = null;
  await provider?.close();
}

/**
 * In `api` mode the browser bootstrap may never run, so the account cache
 * scope comes from the token's verified site info. Called before every tool
 * reads caches: the scope is set from the verified user id each time (not
 * only when site info is first discovered), so a scope cleared or changed by
 * another path is restored. If the credential cannot be verified the scope
 * is cleared, so no cache from an earlier account is served. If a login or
 * logout happens while verifying, that path owns the scope and it is left
 * alone. Other modes keep the browser-derived scope.
 */
export async function ensureEclassAccountScope(): Promise<void> {
  const config = getEclassApiConfig();
  if (config.sourceMode !== 'api') return;
  getDefaultEclassHybridProvider();
  const client = defaultRestClient;
  if (!client) return;
  const generation = getAuthGeneration();
  let userId: string;
  try {
    if (!hasUsableMobileCredential()) return;
    userId = await client.getVerifiedUserId();
  } catch {
    if (getAuthGeneration() === generation) clearActiveEclassAccountScope();
    return;
  }
  if (getAuthGeneration() !== generation) return;
  setScopeFromVerifiedUser(config.origin, userId);
}

function setScopeFromVerifiedUser(origin: string, userId: string): void {
  try {
    setActiveEclassAccountScope(origin, userId);
  } catch {
    // No session secret: leave caching disabled rather than fail reads.
    clearActiveEclassAccountScope();
  }
}

export function createDefaultToolDependencies(): ToolDependencies {
  return {
    eclassScraper: getDefaultEclassHybridProvider(),
    createSisScraper: () => new SISScraper(),
    createRmpClient: () => new RMPClient(),
    createCengageScraper: () => new CengageScraper(),
  };
}
