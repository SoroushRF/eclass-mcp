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
  const options: EclassHybridProviderOptions = {
    playwright: defaultEClassScraper,
    apiClient: new MoodleAjaxClient({
      sessionContext: apiSessionContext,
      origin: config.origin,
      timeoutMs: config.timeoutMs,
    }),
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
