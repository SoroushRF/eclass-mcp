import type {
  Attachment,
  AttachmentKind,
  AssignmentDetails,
  DeadlineItem,
  DeadlineItemType,
  ItemDetails,
  ItemDetailsBase,
  QuizDetails,
} from '../../types/deadlines';

export type {
  Attachment,
  AttachmentKind,
  AssignmentDetails,
  DeadlineItem,
  DeadlineItemType,
  ItemDetails,
  ItemDetailsBase,
  QuizDetails,
};

export interface Course {
  id: string;
  name: string;
  courseCode?: string;
  url: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  author: string;
  discussionUrl?: string;
}

export interface SectionTextData {
  url: string;
  title: string;
  mainText: string;
  mainLinks: Array<{ name: string; url: string }>;
  tabs: Array<{
    title: string;
    content: string;
    links: Array<{ name: string; url: string }>;
  }>;
}

export interface Assignment {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  url: string;
}

export interface Grade {
  courseId: string;
  itemName: string;
  grade: string;
  range: string;
  percentage: string;
  feedback: string;
}

export interface FileItem {
  id: string;
  name: string;
  url: string;
  type: 'pdf' | 'docx' | 'pptx' | 'other';
}

export interface CourseContent {
  courseId: string;
  sections: {
    title: string;
    items: {
      type: 'resource' | 'assign' | 'announcement' | 'other';
      name: string;
      url: string;
    }[];
  }[];
}

export class SessionExpiredError extends Error {
  constructor() {
    super(
      'eClass session expired or invalid. Please re-authenticate at http://localhost:3000/auth'
    );
    this.name = 'SessionExpiredError';
  }
}
