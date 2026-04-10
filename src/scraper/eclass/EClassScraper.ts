import { EClassBrowserSession } from './browser-session';
import type {
  Announcement,
  Assignment,
  AssignmentDetails,
  Course,
  CourseContent,
  DeadlineItem,
  Grade,
  ItemDetails,
  QuizDetails,
  SectionTextData,
} from './types';
import { getAnnouncements } from './announcements';
import {
  getAllAssignmentDeadlines,
  getDeadlines,
  getMonthDeadlines,
} from './deadlines';
import { downloadFile } from './files';
import { getCourses, getCourseContent } from './courses';
import { getGrades } from './grades';
import {
  getAssignmentDetails,
  getItemDetails,
  getQuizDetails,
} from './item-details';
import { getSectionText } from './sections';

export class EClassScraper {
  private readonly session = new EClassBrowserSession();

  getCourses(): Promise<Course[]> {
    return getCourses(this.session);
  }

  getCourseContent(courseId: string): Promise<CourseContent> {
    return getCourseContent(this.session, courseId);
  }

  getDeadlines(courseId?: string): Promise<Assignment[]> {
    return getDeadlines(this.session, courseId);
  }

  getMonthDeadlines(
    month: number,
    year: number,
    courseId?: string
  ): Promise<DeadlineItem[]> {
    return getMonthDeadlines(this.session, month, year, courseId);
  }

  getAllAssignmentDeadlines(courseId?: string): Promise<DeadlineItem[]> {
    return getAllAssignmentDeadlines(this.session, courseId);
  }

  getItemDetails(url: string): Promise<ItemDetails> {
    return getItemDetails(this.session, url);
  }

  getAssignmentDetails(url: string): Promise<AssignmentDetails> {
    return getAssignmentDetails(this.session, url);
  }

  getQuizDetails(url: string): Promise<QuizDetails> {
    return getQuizDetails(this.session, url);
  }

  getGrades(courseId?: string): Promise<Grade[]> {
    return getGrades(this.session, courseId);
  }

  getAnnouncements(
    courseId?: string,
    limit: number = 10
  ): Promise<Announcement[]> {
    return getAnnouncements(this.session, courseId, limit);
  }

  downloadFile(fileUrl: string) {
    return downloadFile(this.session, fileUrl);
  }

  getSectionText(url: string): Promise<SectionTextData> {
    return getSectionText(this.session, url);
  }

  async close() {
    await this.session.close();
  }
}

export const scraper = new EClassScraper();
