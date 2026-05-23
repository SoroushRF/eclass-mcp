import {
  scraper as defaultEClassScraper,
  type EClassScraper,
} from '../scraper/eclass';
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

export function createDefaultToolDependencies(): ToolDependencies {
  return {
    eclassScraper: defaultEClassScraper,
    createSisScraper: () => new SISScraper(),
    createRmpClient: () => new RMPClient(),
    createCengageScraper: () => new CengageScraper(),
  };
}
