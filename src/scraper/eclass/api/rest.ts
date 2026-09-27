import crypto from 'crypto';
import {
  clearMobileCredential,
  getAuthGeneration,
  loadMobileCredential,
  type MobileCredential,
} from '../../session';
import { CREDENTIAL_CHANGED, MoodleApiError } from './errors';
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
  /**
   * Called with the verified Moodle user id whenever it is discovered or
   * returned by `getVerifiedUserId` for the stored credential (sets the
   * account cache scope), so a scope cleared elsewhere is restored.
   */
  onIdentity?: (userId: string) => void;
  /**
   * Auth generation (advanced by login, logout and session clears). Defaults
   * to the session module's counter.
   */
  authGeneration?: () => number;
}

/**
 * Site info discovered for one credential. `fingerprint` is a SHA-256 of the
 * token, held in memory only, so state never outlives the token it was
 * discovered with.
 */
interface BoundIdentity {
  fingerprint: string;
  capabilities: ReadonlySet<string>;
  userId: number | null;
}

class IdentityChangedError extends Error {}

function credentialFingerprint(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function credentialChanged(): MoodleApiError {
  return new MoodleApiError({
    category: 'upstream',
    upstreamCode: CREDENTIAL_CHANGED,
  });
}

// Renewal lineage entries kept per client (one per renewal).
const MAX_RENEWAL_LINEAGE = 16;

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
  private readonly onIdentity?: (userId: string) => void;
  // User id and capabilities are bound to one credential; never logged.
  private bound: BoundIdentity | null = null;
  private discovery: {
    fingerprint: string;
    promise: Promise<BoundIdentity>;
  } | null = null;
  private renewal: {
    fingerprint: string;
    generation: number;
    promise: Promise<void>;
  } | null = null;
  // Failed fingerprint -> the fingerprint its renewal stored. A result from
  // a renewed-away token is still the same account's result.
  private readonly renewedTo = new Map<string, string>();
  private readonly authGeneration: () => number;

  constructor(options: MoodleRestClientOptions) {
    this.transport = options.transport;
    this.credentialReader = options.credentialReader ?? {
      load: () => loadMobileCredential(),
      clear: () => clearMobileCredential(),
    };
    this.reMint = options.reMint;
    this.onIdentity = options.onIdentity;
    this.authGeneration = options.authGeneration ?? getAuthGeneration;
  }

  /**
   * True while a renewal for the current auth generation is in flight. The
   * credential is absent during that window, but reads should still route
   * to REST and join the renewal.
   */
  hasPendingRenewal(): boolean {
    return (
      this.renewal !== null && this.renewal.generation === this.authGeneration()
    );
  }

  async discoverCapabilities(force = false): Promise<ReadonlySet<string>> {
    return new Set((await this.boundIdentity(force)).capabilities);
  }

  async hasCapability(functionName: string): Promise<boolean> {
    const capabilities = await this.discoverCapabilities();
    return capabilities.has(functionName);
  }

  /** The verified Moodle user id for the active credential. */
  async getVerifiedUserId(): Promise<string> {
    const { userId, fingerprint } = await this.boundIdentity();
    if (userId === null) {
      throw new MoodleApiError({
        category: 'malformed_response',
        upstreamCode: 'missing_userid',
      });
    }
    if (this.storedFingerprint() === fingerprint) {
      this.onIdentity?.(String(userId));
    }
    return String(userId);
  }

  getCapabilityNames(): string[] {
    return this.bound ? [...this.bound.capabilities].sort() : [];
  }

  /**
   * Site info for the credential stored right now. Concurrent callers share
   * one discovery, and a replaced credential is always rediscovered.
   */
  private async boundIdentity(force = false): Promise<BoundIdentity> {
    const fingerprint = await this.activeFingerprint();
    if (!force && this.bound?.fingerprint === fingerprint) return this.bound;
    if (force || this.discovery?.fingerprint !== fingerprint) {
      const promise: Promise<BoundIdentity> = this.discover().finally(() => {
        if (this.discovery?.promise === promise) this.discovery = null;
      });
      this.discovery = { fingerprint, promise };
    }
    return this.discovery!.promise;
  }

  private async discover(): Promise<BoundIdentity> {
    const { value: raw, fingerprint } = await this.withCredential((token) =>
      this.post(MOODLE_REST_CAPABILITIES.siteInfo, {}, token)
    );
    const parsed = MoodleRestSiteInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }
    const userId = Number(parsed.data.userid);
    const bound: BoundIdentity = {
      fingerprint,
      userId: Number.isSafeInteger(userId) && userId > 0 ? userId : null,
      capabilities: new Set(
        (parsed.data.functions ?? [])
          .map((fn) => fn.name.trim())
          .filter((name) => name.length > 0)
      ),
    };
    // Publish only while the credential is still the one discovered with.
    if (this.storedFingerprint() === fingerprint) {
      this.bound = bound;
      if (bound.userId !== null) this.onIdentity?.(String(bound.userId));
    }
    return bound;
  }

  private storedFingerprint(): string | null {
    const credential = this.credentialReader.load();
    return credential ? credentialFingerprint(credential.token) : null;
  }

  /** The stored credential's fingerprint, waiting out a pending renewal. */
  private async activeFingerprint(): Promise<string> {
    let fingerprint = this.storedFingerprint();
    if (!fingerprint && (await this.joinPendingRenewal())) {
      fingerprint = this.storedFingerprint();
    }
    if (!fingerprint) {
      throw new MoodleApiError({ category: 'mobile_token_invalid' });
    }
    return fingerprint;
  }

  /**
   * Waits for a renewal started in the current auth generation. Returns
   * false when there is none to join; a failed renewal rejects.
   */
  private async joinPendingRenewal(): Promise<boolean> {
    const pending = this.renewal;
    if (!pending || pending.generation !== this.authGeneration()) return false;
    await pending.promise;
    return true;
  }

  /**
   * Whether a result obtained with `fingerprint` in `generation` still
   * belongs to the active credential: no login, logout or clear since, and
   * the stored token is the same one, its renewal, or being renewed now.
   */
  private isCurrent(fingerprint: string, generation: number): boolean {
    if (this.authGeneration() !== generation) return false;
    const stored = this.storedFingerprint();
    const renewing =
      this.renewal?.generation === generation ? this.renewal.fingerprint : null;
    let candidate: string | undefined = fingerprint;
    for (let hop = 0; candidate && hop <= MAX_RENEWAL_LINEAGE; hop++) {
      if (candidate === stored || candidate === renewing) return true;
      candidate = this.renewedTo.get(candidate);
    }
    return false;
  }

  /**
   * A token failure may renew only while no other account's credential was
   * stored in the meantime. A credential that is simply gone (an earlier
   * failed renewal) can still be renewed in the same generation.
   */
  private mayRenew(fingerprint: string, generation: number): boolean {
    if (this.authGeneration() !== generation) return false;
    return (
      this.storedFingerprint() === null ||
      this.isCurrent(fingerprint, generation)
    );
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
    return this.callRaw(functionName, args);
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

  /**
   * Sends the user id discovered for the same credential that makes the
   * request; a credential replaced mid-call is rediscovered once.
   */
  async getUserCourses(): Promise<MoodleRestUserCourses> {
    const functionName = MOODLE_REST_CAPABILITIES.userCourses;
    for (let attempt = 0; attempt < 2; attempt++) {
      const identity = await this.boundIdentity();
      if (identity.userId === null) {
        throw new MoodleApiError({
          category: 'malformed_response',
          upstreamCode: 'missing_userid',
        });
      }
      if (!identity.capabilities.has(functionName)) {
        throw new MoodleApiError({
          category: 'capability_unavailable',
          upstreamCode: functionName,
        });
      }
      try {
        const { value } = await this.withCredential((token) => {
          if (credentialFingerprint(token) !== identity.fingerprint) {
            throw new IdentityChangedError();
          }
          return this.post(functionName, { userid: identity.userId }, token);
        });
        const parsed = MoodleRestUserCoursesSchema.safeParse(value);
        if (!parsed.success) {
          throw new MoodleApiError({ category: 'malformed_response' });
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof IdentityChangedError) continue;
        throw error;
      }
    }
    throw new MoodleApiError({
      category: 'upstream',
      upstreamCode: 'identity_changed',
    });
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
    args: Record<string, unknown>
  ): Promise<unknown> {
    const { value } = await this.withCredential((token) =>
      this.post(functionName, args, token)
    );
    return value;
  }

  private async post(
    functionName: string,
    args: Record<string, unknown>,
    token: string
  ): Promise<unknown> {
    const raw = await this.transport.postRest(functionName, args, token);
    parseRestError(raw);
    return raw;
  }

  /**
   * Runs `fn` with the stored token. On an invalid token the credential is
   * renewed once (shared with concurrent callers, including ones that arrive
   * while it is in flight) and `fn` retried once. Token file downloads use
   * the same lifecycle.
   *
   * The whole operation is bound to the auth generation it started in: a
   * result that arrives after a login, logout or account switch is rejected
   * with `credential_changed` instead of being returned, and the request is
   * never rerun under a different account's token.
   */
  async withCredential<T>(
    fn: (token: string) => Promise<T>
  ): Promise<{ value: T; fingerprint: string }> {
    const generation = this.authGeneration();
    let renewed = false;
    while (true) {
      if (this.authGeneration() !== generation) throw credentialChanged();
      const credential = this.credentialReader.load();
      if (!credential) {
        if (!renewed && (await this.joinPendingRenewal())) {
          renewed = true;
          continue;
        }
        throw new MoodleApiError({ category: 'mobile_token_invalid' });
      }
      const fingerprint = credentialFingerprint(credential.token);
      let value: T;
      try {
        value = await fn(credential.token);
      } catch (error) {
        if (!isMobileTokenError(error)) throw error;
        if (!this.mayRenew(fingerprint, generation)) throw credentialChanged();
        if (!renewed && this.reMint) {
          renewed = true;
          await this.renew(fingerprint, generation);
          continue;
        }
        this.invalidate(fingerprint);
        throw error;
      }
      if (!this.isCurrent(fingerprint, generation)) throw credentialChanged();
      return { value, fingerprint };
    }
  }

  /**
   * One renewal per failed credential. A caller whose token was already
   * replaced by a concurrent renewal skips minting and retries with the new
   * token. A failed renewal surfaces as `mobile_token_invalid`.
   */
  private renew(failedFingerprint: string, generation: number): Promise<void> {
    if (
      this.renewal?.fingerprint === failedFingerprint &&
      this.renewal.generation === generation
    ) {
      return this.renewal.promise;
    }
    const current = this.storedFingerprint();
    if (current && current !== failedFingerprint) return Promise.resolve();

    const promise: Promise<void> = (async () => {
      this.invalidate(failedFingerprint);
      try {
        await this.reMint!();
      } catch (error) {
        throw new MoodleApiError({
          category: 'mobile_token_invalid',
          upstreamCode: 'renewal_failed',
          cause: error,
        });
      }
      const renewedFingerprint = this.storedFingerprint();
      if (renewedFingerprint && this.authGeneration() === generation) {
        this.renewedTo.set(failedFingerprint, renewedFingerprint);
        if (this.renewedTo.size > MAX_RENEWAL_LINEAGE) {
          const oldest = this.renewedTo.keys().next().value;
          if (oldest !== undefined) this.renewedTo.delete(oldest);
        }
      }
    })().finally(() => {
      if (this.renewal?.promise === promise) this.renewal = null;
    });
    this.renewal = { fingerprint: failedFingerprint, generation, promise };
    return promise;
  }

  /** Forgets state for a failed credential, clearing it only if still stored. */
  private invalidate(fingerprint: string): void {
    if (this.storedFingerprint() === fingerprint) {
      this.credentialReader.clear();
    }
    if (this.bound?.fingerprint === fingerprint) this.bound = null;
  }
}

function isMobileTokenError(error: unknown): boolean {
  return (
    error instanceof MoodleApiError && error.category === 'mobile_token_invalid'
  );
}
