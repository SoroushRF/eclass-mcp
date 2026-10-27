import {
  classifyExternalPlatformCandidate,
  type ExternalPlatformMatch,
} from '../external-platforms';
import { classifyDescriptionExternalLinks } from '../item-details';
import type {
  AssignmentDetails,
  Attachment,
  AttachmentKind,
  QuizDetails,
  SectionTextData,
} from '../types';
import {
  effectiveDueSeconds,
  extractHtmlLinks,
  htmlToPlainText,
  submissionStatusLabel,
} from './rest-mappers';
import type {
  MoodleRestAssignment,
  MoodleRestCourseContents,
  MoodleRestAssignPlugin,
  MoodleRestFile,
  MoodleRestQuiz,
  MoodleRestQuizAttempts,
  MoodleRestQuizBestGrade,
  MoodleRestQuizFeedback,
  MoodleRestSubmissionStatus,
} from './types';

/** Same cap as the Playwright item pages. */
const MAX_ATTACHMENTS = 20;
const ATTACHMENT_HINT = 'Use the get_file_text tool to read this file.';
/** York eClass shows dates in campus time. */
const DISPLAY_TIME_ZONE = 'America/Toronto';

const GRADING_STATUS_LABELS: Record<string, string> = {
  graded: 'Graded',
  notgraded: 'Not graded',
  released: 'Released',
  notmarked: 'Not marked',
  inmarking: 'In marking',
  readyforreview: 'Marking completed',
  inreview: 'In review',
  readyforrelease: 'Ready for release',
};

/**
 * REST returns `/webservice/pluginfile.php` links, which need a token. Tool
 * output uses the browser form; the token file source maps it back.
 */
export function browserPluginfileUrl(url: string): string {
  return url.replace('/webservice/pluginfile.php', '/pluginfile.php');
}

function browserPluginfileHtml(html: string | undefined): string {
  return (html ?? '').replace(
    /\/webservice\/pluginfile\.php/g,
    '/pluginfile.php'
  );
}

export function attachmentKind(nameOrUrl: string): AttachmentKind {
  const h = nameOrUrl.toLowerCase();
  if (h.includes('.pdf')) return 'pdf';
  if (h.includes('.docx')) return 'docx';
  if (h.includes('.pptx')) return 'pptx';
  if (h.match(/\.(png|jpe?g|gif|webp)(\?|#|$)/i)) return 'image';
  if (h.includes('.csv')) return 'csv';
  return 'other';
}

/** Moodle's long date format, e.g. "Friday, 24 October 2025, 11:59 PM". */
export function formatMoodleDate(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: DISPLAY_TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(new Date(seconds * 1000))
      .map((part) => [part.type, part.value])
  );
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  const out: string[] = [];
  if (hours) out.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (mins) out.push(`${mins} ${mins === 1 ? 'min' : 'mins'}`);
  return out.join(' ') || `${seconds} secs`;
}

function formatQuizGrade(value: number, decimals: number | undefined): string {
  return value.toFixed(Math.max(0, Math.min(decimals ?? 2, 5)));
}

function descriptionImageUrls(html: string, pageUrl: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(
    /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
  )) {
    const src = (match[1] ?? match[2] ?? '').replace(/&amp;/g, '&').trim();
    if (!src) continue;
    try {
      urls.add(new URL(src, pageUrl).href);
    } catch {
      // ignore invalid URLs
    }
  }
  return [...urls];
}

function collectAttachments(
  files: Iterable<MoodleRestFile>,
  skip: ReadonlySet<string>
): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>(skip);
  for (const file of files) {
    if (attachments.length >= MAX_ATTACHMENTS) break;
    if (!file.fileurl) continue;
    const url = browserPluginfileUrl(file.fileurl);
    if (seen.has(url)) continue;
    seen.add(url);
    attachments.push({
      url,
      kind: attachmentKind(file.filename || url),
      name: file.filename || undefined,
      hint: ATTACHMENT_HINT,
    });
  }
  return attachments;
}

function pluginFiles(plugins: MoodleRestAssignPlugin[] | undefined) {
  return (plugins ?? []).flatMap((plugin) =>
    (plugin.fileareas ?? []).flatMap((area) => area.files ?? [])
  );
}

function pluginText(
  plugins: MoodleRestAssignPlugin[] | undefined,
  type: string
): string {
  return (plugins ?? [])
    .filter((plugin) => plugin.type === type)
    .flatMap((plugin) => plugin.editorfields ?? [])
    .map((field) => htmlToPlainText(field.text))
    .filter(Boolean)
    .join('\n');
}

function description(intro: string | undefined, pageUrl: string) {
  const html = browserPluginfileHtml(intro).trim();
  const images = descriptionImageUrls(html, pageUrl);
  const externalLinks = classifyDescriptionExternalLinks(
    extractHtmlLinks(html),
    pageUrl
  );
  return {
    descriptionHtml: html || undefined,
    descriptionText: htmlToPlainText(html) || undefined,
    descriptionImageUrls: images.length ? images : undefined,
    externalLinks: externalLinks.length ? externalLinks : undefined,
    images,
  };
}

function setField(
  fields: Record<string, string>,
  key: string,
  value: string | undefined
) {
  if (value) fields[key] = value;
}

/**
 * Builds get_item_details output for an assignment from
 * `mod_assign_get_assignments` and `mod_assign_get_submission_status`.
 * `status` is null when the status could not be read.
 */
export function mapRestAssignmentDetails(input: {
  url: string;
  courseId: string;
  assignment: MoodleRestAssignment;
  status: MoodleRestSubmissionStatus | null;
}): AssignmentDetails {
  const { url, courseId, assignment, status } = input;
  const { images, ...desc } = description(assignment.intro, url);
  const attempt = status?.lastattempt;
  const submission = attempt?.teamsubmission ?? attempt?.submission;
  const dueSeconds = effectiveDueSeconds(assignment.duedate, status);

  const fields: Record<string, string> = {};
  setField(
    fields,
    'Opened',
    formatMoodleDate(assignment.allowsubmissionsfromdate)
  );
  setField(
    fields,
    'Due date',
    formatMoodleDate(dueSeconds) +
      (dueSeconds !== assignment.duedate ? ' (extension granted)' : '')
  );
  setField(fields, 'Cut-off date', formatMoodleDate(assignment.cutoffdate));
  fields['Submission status'] = submissionStatusLabel(status);
  const gradingStatus = attempt?.gradingstatus;
  setField(
    fields,
    'Grading status',
    gradingStatus ? (GRADING_STATUS_LABELS[gradingStatus] ?? gradingStatus) : ''
  );
  // Reading the status creates an empty "new" record; it was not modified.
  if (submission?.status && submission.status !== 'new') {
    setField(
      fields,
      'Last modified',
      formatMoodleDate(submission.timemodified)
    );
  }
  const submittedFiles = pluginFiles(submission?.plugins);
  setField(
    fields,
    'File submissions',
    submittedFiles
      .map((file) => file.filename)
      .filter(Boolean)
      .join(', ')
  );
  const grade = htmlToPlainText(status?.feedback?.gradefordisplay);
  setField(fields, 'Grade', grade);
  const feedbackComments = pluginText(status?.feedback?.plugins, 'comments');
  setField(fields, 'Feedback comments', feedbackComments);

  const attachments = collectAttachments(
    [
      ...(assignment.introattachments ?? []),
      ...(assignment.introfiles ?? []),
      ...submittedFiles,
      ...pluginFiles(status?.feedback?.plugins),
    ],
    new Set(images)
  );

  return {
    kind: 'assign',
    url,
    courseId,
    title: (assignment.name ?? '').trim() || 'Assignment',
    ...desc,
    attachments: attachments.length ? attachments : undefined,
    fields,
    grade: grade || fields['Grading status'] || undefined,
    feedbackText: feedbackComments || undefined,
  };
}

/** Builds get_item_details output for a quiz from the mod_quiz functions. */
export function mapRestQuizDetails(input: {
  url: string;
  courseId: string;
  quiz: MoodleRestQuiz;
  bestGrade: MoodleRestQuizBestGrade | null;
  attempts: MoodleRestQuizAttempts | null;
  feedback: MoodleRestQuizFeedback | null;
}): QuizDetails {
  const { url, courseId, quiz, bestGrade, attempts, feedback } = input;
  const { images, ...desc } = description(quiz.intro, url);

  const fields: Record<string, string> = {};
  setField(fields, 'Opened', formatMoodleDate(quiz.timeopen));
  setField(fields, 'Closes', formatMoodleDate(quiz.timeclose));
  if (quiz.timelimit) fields['Time limit'] = formatDuration(quiz.timelimit);
  if (quiz.attempts !== undefined) {
    fields['Attempts allowed'] = quiz.attempts
      ? String(quiz.attempts)
      : 'Unlimited';
  }
  if (attempts) fields['Attempts made'] = String(attempts.attempts.length);

  let grade: string | undefined;
  if (bestGrade?.hasgrade && typeof bestGrade.grade === 'number') {
    grade =
      quiz.grade !== undefined
        ? `${formatQuizGrade(bestGrade.grade, quiz.decimalpoints)} / ${formatQuizGrade(quiz.grade, quiz.decimalpoints)}`
        : formatQuizGrade(bestGrade.grade, quiz.decimalpoints);
    fields['Highest grade'] = grade;
  }

  const attachments = collectAttachments(
    quiz.introfiles ?? [],
    new Set(images)
  );
  const feedbackText = htmlToPlainText(feedback?.feedbacktext);

  return {
    kind: 'quiz',
    url,
    courseId,
    title: (quiz.name ?? '').trim() || 'Quiz',
    ...desc,
    attachments: attachments.length ? attachments : undefined,
    fields,
    grade,
    feedbackText: feedbackText || undefined,
  };
}

function absoluteLinks(html: string, baseUrl: string) {
  const links: Array<{ name: string; url: string }> = [];
  for (const link of extractHtmlLinks(html)) {
    let url: string;
    try {
      url = new URL(link.url, baseUrl).href;
    } catch {
      continue;
    }
    if (url.startsWith('javascript:')) continue;
    links.push({ name: link.name || url, url });
  }
  return links;
}

/**
 * Builds get_section_text output from `core_course_get_contents` filtered to
 * one section: the section summary, then any labels shown inline in it.
 * Tabs inside the summary are not split out, so their text is in `mainText`.
 */
export function mapRestSectionText(
  sections: MoodleRestCourseContents,
  sectionNumber: number,
  url: string
): SectionTextData | null {
  const section = sections.find(
    (candidate) => candidate.section === sectionNumber
  );
  if (!section) return null;
  const blocks = [
    section.summary,
    ...section.modules
      .filter(
        (module) =>
          module.modname === 'label' &&
          module.visible !== 0 &&
          module.uservisible !== false
      )
      .map((module) => module.description),
  ]
    .map((html) => browserPluginfileHtml(html).trim())
    .filter(Boolean);

  const mainLinks = blocks.flatMap((html) => absoluteLinks(html, url));
  const result: SectionTextData = {
    url,
    title: (section.name ?? '').trim() || 'Section Details',
    mainText: blocks
      .map((html) => htmlToPlainText(html))
      .filter(Boolean)
      .join('\n'),
    mainLinks,
    tabs: [],
  };

  const platforms: ExternalPlatformMatch[] = [];
  const seen = new Set<string>();
  for (const link of mainLinks) {
    const match = classifyExternalPlatformCandidate(link);
    if (!match) continue;
    const identity = `${match.name}|${match.url}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    platforms.push(match);
  }
  if (platforms.length > 0) result.external_platforms = platforms;
  return result;
}
