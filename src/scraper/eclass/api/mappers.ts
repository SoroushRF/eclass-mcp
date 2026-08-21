import {
  buildCourseMetadata,
  extractCourseCode,
  inferItemType,
} from '../helpers';
import type {
  Assignment,
  Course,
  CourseContent,
  DeadlineItem,
} from '../types';
import {
  classifyExternalPlatformCandidate,
  type ExternalPlatformMatch,
} from '../external-platforms';
import type {
  MoodleCalendarData,
  MoodleCourseFormatState,
  MoodleEnrolledCoursesData,
  MoodleCourseModule,
  MoodleCourseFormatSection,
} from './types';

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Moodle API origin must be an HTTPS origin.');
  }
  return parsed.origin;
}

function sameOriginMoodleUrl(
  rawUrl: string | undefined,
  fallbackPath: string,
  origin: string
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl || fallbackPath, origin);
  } catch {
    parsed = new URL(fallbackPath, origin);
  }

  if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
    parsed = new URL(fallbackPath, origin);
  }
  parsed.hash = '';
  return parsed.toString();
}

function cleanText(value: string | undefined, fallback: string): string {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function isVisible(value: boolean | number | undefined): boolean {
  return value !== false && value !== 0;
}

export function mapMoodleCourses(
  data: MoodleEnrolledCoursesData,
  origin: string
): Course[] {
  const normalizedOrigin = normalizeOrigin(origin);
  return data.courses
    .map((record) => {
      const id = String(record.id);
      const name = cleanText(
        record.fullname || record.shortname,
        `Course ${id}`
      );
      const courseCode =
        extractCourseCode(name) ||
        extractCourseCode(record.shortname) ||
        record.idnumber?.trim() ||
        undefined;
      return {
        id,
        name,
        ...(courseCode ? { courseCode } : {}),
        url: sameOriginMoodleUrl(
          undefined,
          `/course/view.php?id=${encodeURIComponent(id)}`,
          normalizedOrigin
        ),
      };
    })
    .filter((course) => course.id.length > 0);
}

type CourseContentSection = CourseContent['sections'][number];

function moduleType(
  module: MoodleCourseModule,
  url: string
): CourseContentSection['items'][number]['type'] {
  const value = `${module.modname || module.plugin || ''} ${url}`.toLowerCase();
  if (value.includes('assign')) return 'assign';
  if (value.includes('forum')) return 'announcement';
  if (value.includes('lti')) return 'lti';
  if (value.includes('/mod/url/') || value.trim() === 'url') return 'url';
  if (value.includes('resource') || value.includes('folder')) return 'resource';
  return 'other';
}

function sectionNumber(section: MoodleCourseFormatSection): string {
  return String(section.number ?? section.section ?? section.id ?? '0');
}

function moduleBelongsToSection(
  module: MoodleCourseModule,
  section: MoodleCourseFormatSection
): boolean {
  const sectionId = String(section.id ?? '');
  const number = sectionNumber(section);
  const listedModuleIds = (section.cmlist ?? []).map((entry) => {
    if (typeof entry === 'object' && entry !== null && 'id' in entry) {
      return String((entry as { id?: unknown }).id ?? '');
    }
    return String(entry);
  });
  return (
    (module.sectionid !== undefined &&
      String(module.sectionid) === sectionId) ||
    (module.sectionnumber !== undefined &&
      String(module.sectionnumber) === number) ||
    listedModuleIds.includes(String(module.id))
  );
}

function externalPlatforms(
  sections: CourseContentSection[]
): ExternalPlatformMatch[] {
  const matches: ExternalPlatformMatch[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    for (const item of section.items) {
      const match = classifyExternalPlatformCandidate({
        name: item.name,
        url: item.url,
        itemType: item.type,
      });
      if (!match) continue;
      const identity = `${match.name}|${match.url}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      matches.push(match);
    }
  }
  return matches;
}

export function mapMoodleCourseContent(
  data: MoodleCourseFormatState,
  courseId: string | number,
  origin: string
): CourseContent {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedCourseId = String(courseId);
  const modules = data.cm.filter((module) =>
    isVisible(module.visible) && isVisible(module.uservisible)
  );
  const sections = data.section
    .filter((section) => isVisible(section.visible) && isVisible(section.uservisible))
    .map((section) => {
    const number = sectionNumber(section);
    const sectionModules = modules.filter((module) =>
      moduleBelongsToSection(module, section)
    );
    const items = sectionModules.map((module) => {
      const id = String(module.id);
      const modname = module.modname || module.plugin || 'resource';
      const url = sameOriginMoodleUrl(
        module.url,
        `/mod/${encodeURIComponent(modname)}/view.php?id=${encodeURIComponent(id)}`,
        normalizedOrigin
      );
      return {
        type: moduleType(module, url),
        name: cleanText(module.name, `Activity ${id}`),
        url,
      };
    });
    return {
      title: cleanText(
        section.title || section.rawtitle,
        number === '0' ? 'General' : `Section ${number}`
      ),
      items,
    };
    });

  const withUnassignedModules = modules.filter(
    (module) => !sections.some((section) =>
      section.items.some((item) => item.url.includes(`id=${module.id}`))
    )
  );
  if (withUnassignedModules.length > 0) {
    sections.push({
      title: 'Other',
      items: withUnassignedModules.map((module) => {
        const id = String(module.id);
        const modname = module.modname || module.plugin || 'resource';
        const url = sameOriginMoodleUrl(
          module.url,
          `/mod/${encodeURIComponent(modname)}/view.php?id=${encodeURIComponent(id)}`,
          normalizedOrigin
        );
        return {
          type: moduleType(module, url),
          name: cleanText(module.name, `Activity ${id}`),
          url,
        };
      }),
    });
  }

  const nonEmptySections = sections.filter((section) => section.items.length > 0);
  const platforms = externalPlatforms(nonEmptySections);
  return {
    courseId: normalizedCourseId,
    sections: nonEmptySections,
    ...(platforms.length > 0 ? { external_platforms: platforms } : {}),
  };
}

export function isMoodleCourseContentComplete(
  data: MoodleCourseFormatState
): boolean {
  const expectedSections = data.course.numsections;
  if (expectedSections === undefined) return true;
  return data.section.length >= expectedSections;
}

function eventUrl(
  event: MoodleCalendarData['events'][number],
  origin: string
): string {
  const id = String(event.id ?? event.eventid ?? '');
  const module = event.modulename || 'assign';
  return sameOriginMoodleUrl(
    event.url || event.action?.url,
    `/mod/${encodeURIComponent(module)}/view.php?id=${encodeURIComponent(id)}`,
    normalizeOrigin(origin)
  );
}

function eventTimestamp(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isDeadlineEvent(
  event: MoodleCalendarData['events'][number],
  url: string
): boolean {
  const value = `${event.modulename || ''} ${url}`.toLowerCase();
  return value.includes('assign') || value.includes('quiz');
}

export function mapMoodleCalendarToAssignments(
  data: MoodleCalendarData,
  origin: string
): Assignment[] {
  return data.events
    .map((event) => {
      const url = eventUrl(event, origin);
      const courseId = String(event.course?.id ?? '');
      const courseName = event.course?.fullname || event.course?.shortname;
      const name = cleanText(event.name, 'Untitled deadline');
      const eventId = String(
        event.id ??
          event.eventid ??
          `${courseId}:${name}:${event.timestart ?? event.timesort ?? ''}`
      );
      return {
        id: eventId,
        name,
        dueDate: eventTimestamp(event.timestart ?? event.timesort),
        status: 'Upcoming',
        courseId,
        ...(courseName ? { courseName } : {}),
        ...(courseName && extractCourseCode(courseName)
          ? { courseCode: extractCourseCode(courseName) }
          : {}),
        url,
      };
    })
    .filter((assignment, index) =>
      isDeadlineEvent(data.events[index]!, assignment.url)
    );
}

export function mapMoodleCalendarToDeadlineItems(
  data: MoodleCalendarData,
  origin: string
): DeadlineItem[] {
  return mapMoodleCalendarToAssignments(data, origin).map((assignment) => ({
    ...assignment,
    type: inferItemType(assignment.url),
    ...buildCourseMetadata(assignment.courseId, assignment.courseName),
  }));
}

export function mapMoodleCoursesToMap(
  data: MoodleEnrolledCoursesData,
  origin: string
): Map<string, Course> {
  return new Map(
    mapMoodleCourses(data, origin).map((course) => [course.id, course])
  );
}
