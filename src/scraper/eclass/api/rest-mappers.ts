import { buildCourseMetadata, extractCourseCode } from '../helpers';
import { extractExternalAnnouncementLinks } from '../announcements';
import type {
  Announcement,
  Course,
  CourseContent,
  DeadlineItem,
  Grade,
} from '../types';
import { mapMoodleCourseContent } from './mappers';
import type {
  MoodleCourseFormatState,
  MoodleRestAssignmentsData,
  MoodleRestCourseContents,
  MoodleRestForumDiscussions,
  MoodleRestGradeItemsData,
  MoodleRestOverviewGrades,
  MoodleRestSubmissionStatus,
  MoodleRestUserCourses,
} from './types';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = String(entity).toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/** Converts Moodle-formatted HTML to plain text for tool output. */
export function htmlToPlainText(html: string | undefined): string {
  if (!html) return '';
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Extracts anchors from Moodle-formatted HTML. */
export function extractHtmlLinks(
  html: string | undefined
): Array<{ name: string; url: string }> {
  if (!html) return [];
  const links: Array<{ name: string; url: string }> = [];
  const anchor =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const url = decodeEntities((match[1] ?? match[2] ?? '').trim());
    if (!url) continue;
    links.push({ name: htmlToPlainText(match[3]), url });
  }
  return links;
}

function isVisible(value: boolean | number | undefined): boolean {
  return value !== false && value !== 0;
}

function isoFromSeconds(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  return new Date(seconds * 1000).toISOString();
}

function moodleUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

export function mapRestUserCourses(
  data: MoodleRestUserCourses,
  origin: string
): Course[] {
  return data
    .filter((record) => isVisible(record.visible) && record.hidden !== true)
    .map((record) => {
      const id = String(record.id);
      const name =
        (record.fullname || record.shortname || '')
          .replace(/\s+/g, ' ')
          .trim() || `Course ${id}`;
      const courseCode =
        extractCourseCode(name) ||
        extractCourseCode(record.shortname) ||
        record.idnumber?.trim() ||
        undefined;
      return {
        id,
        name,
        ...(courseCode ? { courseCode } : {}),
        url: moodleUrl(origin, `/course/view.php?id=${encodeURIComponent(id)}`),
      };
    });
}

/**
 * Maps `core_course_get_contents` onto the course-format-state shape so both
 * gateways share one CourseContent mapper and external-platform classifier.
 */
export function mapRestCourseContents(
  data: MoodleRestCourseContents,
  courseId: string | number,
  origin: string
): CourseContent {
  const state: MoodleCourseFormatState = {
    course: { id: courseId },
    section: data.map((section) => ({
      id: section.id,
      number: section.section,
      title: section.name,
      visible: section.visible,
      uservisible: section.uservisible,
    })),
    cm: data.flatMap((section) =>
      section.modules.map((module) => ({
        id: module.id,
        name: module.name,
        modname: module.modname,
        url: module.url,
        visible: module.visible,
        uservisible: module.uservisible,
        sectionid: section.id,
      }))
    ),
  } as MoodleCourseFormatState;
  return mapMoodleCourseContent(state, courseId, origin);
}

function gradeItemName(
  item: MoodleRestGradeItemsData['usergrades'][number]['gradeitems'][number]
): string {
  const name = htmlToPlainText(item.itemname ?? '');
  if (item.itemtype === 'course') return 'Course total';
  if (item.itemtype === 'category') {
    return name ? `${name} total` : 'Category total';
  }
  return name || 'Item';
}

export function mapRestGradeItems(data: MoodleRestGradeItemsData): Grade[] {
  return data.usergrades.flatMap((usergrade) =>
    usergrade.gradeitems
      .filter((item) => item.gradeishidden !== true && item.gradeishidden !== 1)
      .map((item) => ({
        courseId: String(usergrade.courseid),
        itemName: gradeItemName(item),
        grade: htmlToPlainText(item.gradeformatted) || '-',
        range: htmlToPlainText(item.rangeformatted) || '-',
        percentage: htmlToPlainText(item.percentageformatted) || '-',
        feedback: htmlToPlainText(item.feedback),
      }))
  );
}

export function mapRestOverviewGrades(
  data: MoodleRestOverviewGrades,
  courses: readonly Course[]
): Grade[] {
  const names = new Map(courses.map((course) => [course.id, course.name]));
  return data.grades.map((entry) => {
    const courseId = String(entry.courseid);
    return {
      courseId,
      itemName: names.get(courseId) ?? `Course ${courseId}`,
      grade: htmlToPlainText(entry.grade) || '-',
      range: '-',
      percentage: '-',
      feedback: '',
    };
  });
}

export function mapRestForumDiscussions(
  data: MoodleRestForumDiscussions,
  origin: string,
  limit: number
): Announcement[] {
  return data.discussions.slice(0, Math.max(0, limit)).map((discussion) => {
    const discussionId = String(discussion.discussion);
    const discussionUrl = moodleUrl(
      origin,
      `/mod/forum/discuss.php?d=${encodeURIComponent(discussionId)}`
    );
    return {
      id: discussionId,
      title:
        htmlToPlainText(discussion.name || discussion.subject) || 'Untitled',
      content:
        htmlToPlainText(discussion.message) || 'Could not fetch content.',
      date: isoFromSeconds(discussion.created ?? discussion.timemodified),
      author: (discussion.userfullname ?? '').trim(),
      discussionUrl,
      links: extractExternalAnnouncementLinks(
        extractHtmlLinks(discussion.message),
        discussionUrl
      ),
    };
  });
}

/**
 * Moodle's own assignment-index wording for `lastattempt.submission.status`,
 * so REST and Playwright report the same status strings.
 */
const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  new: 'No submission',
  draft: 'Draft (not submitted)',
  submitted: 'Submitted for grading',
  reopened: 'Reopened',
};

export function submissionStatusLabel(
  status: MoodleRestSubmissionStatus | null
): string {
  const raw =
    status?.lastattempt?.submission?.status ??
    status?.lastattempt?.teamsubmission?.status;
  if (!raw) return 'No submission';
  return SUBMISSION_STATUS_LABELS[raw] ?? raw;
}

export function mapRestAssignments(
  data: MoodleRestAssignmentsData,
  origin: string,
  statuses: ReadonlyMap<string, MoodleRestSubmissionStatus | null>
): DeadlineItem[] {
  return data.courses.flatMap((course) => {
    const courseId = String(course.id);
    const courseName = (course.fullname || course.shortname || '').trim();
    return course.assignments.map((assignment) => {
      const cmid = String(assignment.cmid);
      const status = statuses.get(String(assignment.id)) ?? null;
      const label = submissionStatusLabel(status);
      const grade = htmlToPlainText(status?.feedback?.gradefordisplay);
      return {
        id: cmid,
        name: (assignment.name ?? '').trim() || `Assignment ${cmid}`,
        dueDate: isoFromSeconds(assignment.duedate),
        status: label,
        url: moodleUrl(
          origin,
          `/mod/assign/view.php?id=${encodeURIComponent(cmid)}`
        ),
        type: 'assign' as const,
        section: '',
        submission: label,
        grade: grade || '-',
        ...buildCourseMetadata(courseId, courseName),
      };
    });
  });
}
