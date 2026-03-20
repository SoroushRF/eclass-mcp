export type DeadlineItemType = 'assign' | 'quiz' | 'other';

export interface DeadlineItem {
  id: string;
  name: string;
  dueDate: string;
  status: string;
  courseId: string;
  url: string;
  type: DeadlineItemType;
  section?: string;
  submission?: string;
  grade?: string;
}

export interface ItemDetailsBase {
  url: string;
  title: string;
  descriptionText?: string;
  descriptionHtml?: string;
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

