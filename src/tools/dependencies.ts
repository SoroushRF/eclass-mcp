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
import { loadMobileCredential } from '../scraper/session';
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
  const launcher = new MoodleMobileLauncher({
    sessionContext: apiSessionContext,
    origin: config.origin,
    timeoutMs: config.timeoutMs,
  });
  const restClient = new MoodleRestClient({
    transport: new FetchMoodleRestTransport({
      origin: config.origin,
      timeoutMs: config.timeoutMs,
    }),
    reMint: () => launcher.launch(),
  });
  const options: EclassHybridProviderOptions = {
    playwright: defaultEClassScraper,
    tokenFiles: {
      download: async (fileUrl) => {
        if (!toWebservicePluginfileUrl(fileUrl)) return null;
        const credential = loadMobileCredential();
        if (!credential) return null;
        return downloadFileWithToken(fileUrl, credential.token);
      },
    },
    apiClient: new MoodleAjaxClient({
      sessionContext: apiSessionContext,
      origin: config.origin,
      timeoutMs: config.timeoutMs,
    }),
    restClient,
    hasMobileCredential: () => {
      try {
        return loadMobileCredential() !== null;
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
  await provider?.close();
}

export function createDefaultToolDependencies(): ToolDependencies {
  return {
    eclassScraper: getDefaultEclassHybridProvider(),
    createSisScraper: () => new SISScraper(),
    createRmpClient: () => new RMPClient(),
    createCengageScraper: () => new CengageScraper(),
  };
}
