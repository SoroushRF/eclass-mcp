import {
  scraper as defaultEClassScraper,
  type EClassScraper,
} from '../scraper/eclass';
import { RMPClient } from '../scraper/rmp';
import { SISScraper } from '../scraper/sis';

export type EclassScraperDependency = Pick<
  EClassScraper,
  | 'getCourses'
  | 'getCourseContent'
  | 'getDeadlines'
  | 'getAllAssignmentDeadlines'
  | 'getItemDetails'
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

export interface ToolDependencies {
  eclassScraper: EclassScraperDependency;
  createSisScraper: () => SisScraperDependency;
  createRmpClient: () => RmpClientDependency;
}

export function createDefaultToolDependencies(): ToolDependencies {
  return {
    eclassScraper: defaultEClassScraper,
    createSisScraper: () => new SISScraper(),
    createRmpClient: () => new RMPClient(),
  };
}
