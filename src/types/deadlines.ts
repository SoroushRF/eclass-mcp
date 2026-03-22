export type DeadlineItemType = 'assign' | 'quiz' | 'other';

export interface DeadlineItem {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  url: string;
  type: DeadlineItemType;
  section?: string;
  submission?: string;
  grade?: string;
}

export interface ItemDetailsBase {
  url: string;
  courseId?: string;
  title: string;
  descriptionText?: string;
  descriptionHtml?: string;
  /**
   * Instruction images extracted from descriptionHtml (vision-only; no OCR).
   * When present, the tool layer may optionally attach image bytes to the MCP response.
   */
  descriptionImageUrls?: string[];

  /**
   * Downloadable resources linked from the assignment/quiz page.
   * These may include PDFs, DOCX, images, CSV, etc.
   */
  attachments?: Array<Attachment>;
}

export type AttachmentKind =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'image'
  | 'csv'
  | 'other';

export interface Attachment {
  url: string;
  kind: AttachmentKind;
  name?: string;
  hint?: string;
}

export interface AssignmentDetails extends ItemDetailsBase {
  kind: 'assign';
  fields?: Record<string, string>;
  grade?: string;
  feedbackText?: string;
}

export interface QuizDetails extends ItemDetailsBase {
  kind: 'quiz';
  fields?: Record<string, string>;
  grade?: string;
  feedbackText?: string;
}

export type ItemDetails = AssignmentDetails | QuizDetails;
