import {
  clearMobileCredential,
  loadMobileCredential,
  type MobileCredential,
} from '../../session';
import { MoodleApiError } from './errors';
import type { MoodleTransport } from './transport';
import type { z } from 'zod';
import {
  MoodleCalendarDataSchema,
  MoodleRestAssignmentsDataSchema,
  MoodleRestCourseContentsSchema,
  MoodleRestErrorEnvelopeSchema,
  MoodleRestForumDiscussionsSchema,
  MoodleRestForumsDataSchema,
  MoodleRestGradeItemsDataSchema,
  MoodleRestOverviewGradesSchema,
  MoodleRestSiteInfoSchema,
  MoodleRestSubmissionStatusSchema,
  MoodleRestUserCoursesSchema,
  type MoodleCalendarData,
  type MoodleRestAssignmentsData,
  type MoodleRestCourseContents,
  type MoodleRestForumDiscussions,
  type MoodleRestForumsData,
  type MoodleRestGradeItemsData,
  type MoodleRestOverviewGrades,
  type MoodleRestSubmissionStatus,
  type MoodleRestUserCourses,
} from './types';

export const MOODLE_REST_CAPABILITIES = {
  siteInfo: 'core_webservice_get_site_info',
  courseContents: 'core_course_get_contents',
  assignments: 'mod_assign_get_assignments',
  forums: 'mod_forum_get_forums_by_courses',
  forumDiscussions: 'mod_forum_get_forum_discussions',
  actionEvents: 'core_calendar_get_action_events_by_timesort',
  courseActionEvents: 'core_calendar_get_action_events_by_course',
  gradeItems: 'gradereport_user_get_grade_items',
  overviewGrades: 'gradereport_overview_get_course_grades',
  submissionStatus: 'mod_assign_get_submission_status',
  userCourses: 'core_enrol_get_users_courses',
  pluginFiles: 'core_files_get_files',
} as const;

/**
 * Mobile REST functions the tool routing plan depends on. The owner probe
 * reports presence for each; tools stay capability-gated at runtime.
 */
export const MOODLE_REST_ROUTING_FUNCTIONS = [
  'core_course_get_contents',
  'mod_page_get_pages_by_courses',
  'mod_label_get_labels_by_courses',
  'mod_resource_get_resources_by_courses',
  'mod_folder_get_folders_by_courses',
  'mod_url_get_urls_by_courses',
  'mod_lti_get_ltis_by_courses',
  'gradereport_overview_get_course_grades',
  'gradereport_user_get_grade_items',
  'mod_forum_get_forums_by_courses',
  'mod_forum_get_forum_discussions',
  'mod_forum_get_discussion_posts',
  'mod_assign_get_assignments',
  'mod_assign_get_submission_status',
  'mod_quiz_get_quizzes_by_courses',
  'mod_quiz_get_user_attempts',
  'core_calendar_get_action_events_by_timesort',
  'core_calendar_get_action_events_by_course',
  'core_enrol_get_users_courses',
  'core_course_get_updates_since',
  'core_files_get_files',
  'tool_mobile_get_autologin_key',
] as const;

export type MoodleRestCapability =
  (typeof MOODLE_REST_CAPABILITIES)[keyof typeof MOODLE_REST_CAPABILITIES];

export interface MobileCredentialReader {
  load(): MobileCredential | null;
  clear(): void;
}

export interface MoodleRestClientOptions {
  transport: Pick<MoodleTransport, 'postRest'>;
  credentialReader?: MobileCredentialReader;
  reMint?: () => Promise<MobileCredential>;
}

function parseRestError(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const parsed = MoodleRestErrorEnvelopeSchema.safeParse(value);
  if (!parsed.success || !parsed.data.errorcode) return;

  const errorCode = parsed.data.errorcode.toLowerCase();
  if (errorCode === 'invalidtoken') {
    throw new MoodleApiError({
      category: 'mobile_token_invalid',
      upstreamCode: errorCode,
    });
  }
  if (
    errorCode === 'requireloginerror' ||
    errorCode === 'invalidsesskey' ||
    errorCode === 'accessdenied'
  ) {
    throw new MoodleApiError({
      category: 'session_invalid',
      upstreamCode: errorCode,
    });
  }
  if (errorCode === 'invalidparameter') {
    throw new MoodleApiError({
      category: 'invalid_parameter',
      upstreamCode: errorCode,
    });
  }
  if (errorCode === 'servicenotavailable' || errorCode === 'accessexception') {
    throw new MoodleApiError({
      category: 'capability_unavailable',
      upstreamCode: errorCode,
    });
  }
  throw new MoodleApiError({
    category: 'upstream',
    upstreamCode: errorCode,
  });
}

export class MoodleRestClient {
  private readonly transport: Pick<MoodleTransport, 'postRest'>;
  private readonly credentialReader: MobileCredentialReader;
  private readonly reMint?: () => Promise<MobileCredential>;
  private capabilities: ReadonlySet<string> | null = null;
  // Kept in memory only for `core_enrol_get_users_courses`; never logged.
  private userId: number | null = null;

  constructor(options: MoodleRestClientOptions) {
    this.transport = options.transport;
    this.credentialReader = options.credentialReader ?? {
      load: () => loadMobileCredential(),
      clear: () => clearMobileCredential(),
    };
    this.reMint = options.reMint;
  }

  async discoverCapabilities(force = false): Promise<ReadonlySet<string>> {
    if (this.capabilities && !force) {
      return new Set(this.capabilities);
    }
    const raw = await this.callRaw(MOODLE_REST_CAPABILITIES.siteInfo, {}, true);
    const parsed = MoodleRestSiteInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }
    const userId = Number(parsed.data.userid);
    this.userId = Number.isInteger(userId) && userId > 0 ? userId : null;
    this.capabilities = new Set(
      (parsed.data.functions ?? [])
        .map((fn) => fn.name.trim())
        .filter((name) => name.length > 0)
    );
    return new Set(this.capabilities);
  }

  async hasCapability(functionName: string): Promise<boolean> {
    const capabilities = await this.discoverCapabilities();
    return capabilities.has(functionName);
  }

  getCapabilityNames(): string[] {
    return this.capabilities ? [...this.capabilities].sort() : [];
  }

  async callCapability(
    functionName: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    if (functionName !== MOODLE_REST_CAPABILITIES.siteInfo) {
      const available = await this.hasCapability(functionName);
      if (!available) {
        throw new MoodleApiError({
          category: 'capability_unavailable',
          upstreamCode: functionName,
        });
      }
    }
    return this.callRaw(functionName, args, true);
  }

  async getCourseContents(
    courseId: string | number
  ): Promise<MoodleRestCourseContents> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.courseContents,
      { courseid: Number(courseId) },
      MoodleRestCourseContentsSchema
    );
  }

  async getUserCourses(): Promise<MoodleRestUserCourses> {
    await this.discoverCapabilities();
    if (this.userId === null) {
      throw new MoodleApiError({
        category: 'malformed_response',
        upstreamCode: 'missing_userid',
      });
    }
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.userCourses,
      { userid: this.userId },
      MoodleRestUserCoursesSchema
    );
  }

  async getActionEventsByTimesort(args: {
    timesortfrom: number;
    limitnum: number;
    aftereventid?: number;
  }): Promise<MoodleCalendarData> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.actionEvents,
      args,
      MoodleCalendarDataSchema
    );
  }

  /** Course-scoped action events, so one busy course cannot crowd out another. */
  async getActionEventsByCourse(args: {
    courseid: number;
    timesortfrom: number;
    limitnum: number;
    aftereventid?: number;
  }): Promise<MoodleCalendarData> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.courseActionEvents,
      args,
      MoodleCalendarDataSchema
    );
  }

  async getAssignments(
    courseIds: readonly (string | number)[]
  ): Promise<MoodleRestAssignmentsData> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.assignments,
      { courseids: courseIds.map(Number) },
      MoodleRestAssignmentsDataSchema
    );
  }

  async getSubmissionStatus(
    assignId: string | number
  ): Promise<MoodleRestSubmissionStatus> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.submissionStatus,
      { assignid: Number(assignId) },
      MoodleRestSubmissionStatusSchema
    );
  }

  async getForums(
    courseIds: readonly (string | number)[]
  ): Promise<MoodleRestForumsData> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.forums,
      { courseids: courseIds.map(Number) },
      MoodleRestForumsDataSchema
    );
  }

  async getForumDiscussions(
    forumId: string | number,
    perPage: number
  ): Promise<MoodleRestForumDiscussions> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.forumDiscussions,
      { forumid: Number(forumId), page: 0, perpage: perPage },
      MoodleRestForumDiscussionsSchema
    );
  }

  async getGradeItems(
    courseId?: string | number
  ): Promise<MoodleRestGradeItemsData> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.gradeItems,
      courseId === undefined ? {} : { courseid: Number(courseId) },
      MoodleRestGradeItemsDataSchema
    );
  }

  async getOverviewGrades(): Promise<MoodleRestOverviewGrades> {
    return this.callParsed(
      MOODLE_REST_CAPABILITIES.overviewGrades,
      {},
      MoodleRestOverviewGradesSchema
    );
  }

  private async callParsed<T>(
    functionName: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>
  ): Promise<T> {
    const raw = await this.callCapability(functionName, args);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }
    return parsed.data;
  }

  private async callRaw(
    functionName: string,
    args: Record<string, unknown>,
    allowReMint: boolean
  ): Promise<unknown> {
    let attemptedReMint = false;
    while (true) {
      const credential = this.credentialReader.load();
      if (!credential) {
        throw new MoodleApiError({ category: 'mobile_token_invalid' });
      }
      try {
        const raw = await this.transport.postRest(
          functionName,
          args,
          credential.token
        );
        parseRestError(raw);
        return raw;
      } catch (error) {
        if (
          isMobileTokenError(error) &&
          allowReMint &&
          !attemptedReMint &&
          this.reMint
        ) {
          attemptedReMint = true;
          this.credentialReader.clear();
          await this.reMint();
          this.capabilities = null;
          continue;
        }
        if (isMobileTokenError(error)) {
          this.credentialReader.clear();
        }
        throw error;
      }
    }
  }
}

function isMobileTokenError(error: unknown): boolean {
  return (
    error instanceof MoodleApiError && error.category === 'mobile_token_invalid'
  );
}
