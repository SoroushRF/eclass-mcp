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
  links: {
    name: string;
    url: string;
    sourceDiscussionUrl: string;
  }[];
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
  external_platforms?: {
    name: string;
    url: string;
    signal?:
      | 'lti'
      | 'keyword_url'
      | 'keyword_name'
      | 'url_activity'
      | 'resource_activity';
  }[];
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
      type: 'resource' | 'assign' | 'announcement' | 'lti' | 'url' | 'other';
      name: string;
      url: string;
    }[];
  }[];
  external_platforms?: {
    name: string;
    url: string;
    signal?:
      | 'lti'
      | 'keyword_url'
      | 'keyword_name'
      | 'url_activity'
      | 'resource_activity';
  }[];
}

export interface SubmissionCurrentFile extends Record<string, unknown> {
  name: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface SubmissionUploadSlot extends Record<string, unknown> {
  kind: 'file' | 'online_text' | 'unknown';
  id?: string;
  label?: string;
  required?: boolean;
  accepts?: string[];
  maxBytes?: number;
  maxFiles?: number;
  canUpload?: boolean;
  currentFiles?: SubmissionCurrentFile[];
}

export interface AssignmentSubmissionPreflightData {
  kind: 'assign';
  url: string;
  courseId?: string;
  title: string;
  cmId?: string;
  dueDate?: string;
  dueDateIso?: string;
  cutoffDate?: string;
  submissionState?: string;
  gradingState?: string;
  isFinalized?: boolean;
  canEditSubmission?: boolean;
  canSubmitFinal?: boolean;
  fields?: Record<string, string>;
  uploadSlots: SubmissionUploadSlot[];
  warnings?: string[];
}

import { SessionExpiredError } from '../session';
export { SessionExpiredError };
