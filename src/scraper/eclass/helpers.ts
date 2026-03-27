import type { DeadlineItem, DeadlineItemType, Assignment } from './types';
import { SessionExpiredError } from './types';
import type { Page } from 'playwright';

export async function checkSession(page: Page) {
  if (page.url().includes('login') || page.url().includes('saml')) {
    throw new SessionExpiredError();
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractCourseCode(name?: string): string | undefined {
  if (!name) return undefined;

  const normalized = normalizeWhitespace(name);
  const patterns = [
    /\b([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\b/,
    /\b([A-Z]{2,5}\s\d{3,4}\s?[A-Z]?)\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/\s+/g, '');
    }
  }

  return undefined;
}

function buildCourseMetadata(courseId: string, courseName?: string) {
  const cleanName = courseName ? normalizeWhitespace(courseName) : undefined;
  return {
    courseId,
    courseName: cleanName || undefined,
    courseCode: extractCourseCode(cleanName),
  };
}

function inferItemType(url: string): DeadlineItemType {
  const u = url.toLowerCase();
  if (u.includes('/mod/assign/')) return 'assign';
  if (u.includes('/mod/quiz/')) return 'quiz';
  if (u.includes('assign')) return 'assign';
  if (u.includes('quiz')) return 'quiz';
  return 'other';
}

function toDeadlineItem(a: Assignment): DeadlineItem {
  return { ...a, type: inferItemType(a.url) };
}

export {
  normalizeWhitespace,
  extractCourseCode,
  buildCourseMetadata,
  inferItemType,
  toDeadlineItem,
};
