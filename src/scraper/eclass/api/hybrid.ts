import { getLogger } from '../../../logging/context';
import {
  createSafeApiLogFields,
  serializeApiErrorForLog,
} from '../../../logging/api-safe';
import { getEclassApiConfig, type EclassSourceMode } from './constants';
import {
  compareAnnouncementCanary,
  compareAssignmentIndexCanary,
  compareCourseCanary,
  compareCourseContentCanary,
  compareDeadlineCanary,
  compareGradeCanary,
  type HybridCanaryComparison,
} from './canary';
import { isMoodleApiError, MoodleApiError } from './errors';
import type { MoodleAjaxClient } from './client';
import {
  isMoodleCourseContentComplete,
  mapMoodleCalendarToAssignments,
  mapMoodleCourseContent,
  mapMoodleCourses,
} from './mappers';
import {
  mapRestAssignments,
  mapRestCourseContents,
  mapRestForumDiscussions,
  mapRestGradeItems,
  mapRestOverviewGrades,
  mapRestUserCourses,
} from './rest-mappers';
import type { MoodleRestClient } from './rest';
import type {
  MoodleCalendarData,
  MoodleCourseFormatState,
  MoodleEnrolledCoursesData,
  MoodleRestSubmissionStatus,
} from './types';
import type { EclassApiSessionContext } from './session-context';
import type { DownloadedFile } from './token-files';
import type {
  Announcement,
  Assignment,
  AssignmentSubmissionPreflightData,
  Course,
  CourseContent,
  DeadlineItem,
  Grade,
  ItemDetails,
  SectionTextData,
} from '../types';
import type { EclassScraperDependency } from '../../../tools/dependencies';

type ApiReader = Pick<
  MoodleAjaxClient,
  | 'getEnrolledCourses'
  | 'getCourseFormatState'
  | 'getCalendarUpcoming'
  | 'getCalendarActionEventsByTimesort'
>;

/** Token-authenticated Moodle REST reads (ADR 0011). */
export type RestReader = Pick<
  MoodleRestClient,
  | 'getCourseContents'
  | 'getUserCourses'
  | 'getActionEventsByTimesort'
  | 'getAssignments'
  | 'getSubmissionStatus'
  | 'getForums'
  | 'getForumDiscussions'
  | 'getGradeItems'
  | 'getOverviewGrades'
>;

type ShadowComparator<T> = (
  apiValue: T,
  playwrightValue: T
) => HybridCanaryComparison;

/** Token-authenticated file source; returns null when it does not apply. */
export interface TokenFileSource {
  download(fileUrl: string): Promise<DownloadedFile | null>;
}

export interface EclassHybridProviderOptions {
  playwright: EclassScraperDependency;
  tokenFiles?: TokenFileSource;
  apiClient?: ApiReader;
  restClient?: RestReader;
  /** Cheap presence check so REST is skipped, not failed, without a token. */
  hasMobileCredential?: () => boolean;
  apiSessionContext?: Pick<EclassApiSessionContext, 'close'>;
  closeOwnedResources?: () => Promise<void>;
  mode?: EclassSourceMode;
  origin?: string;
  shadowTimeoutMs?: number;
}

type FallbackTarget = 'playwright' | 'ajax' | 'rest';

const DEFAULT_SHADOW_TIMEOUT_MS = 2_000;
const SUBMISSION_STATUS_CONCURRENCY = 4;

const FALLBACK_MESSAGES: Record<FallbackTarget, string> = {
  playwright: 'eClass API read falling back to Playwright',
  ajax: 'eClass API read falling back to session AJAX',
  rest: 'eClass API read falling back to token REST',
};

function isFallbackEligible(error: unknown): boolean {
  if (!isMoodleApiError(error)) return true;
  return (
    error.category !== 'session_invalid' && error.category !== 'rate_limited'
  );
}

function apiFailureReason(error: unknown): string {
  if (isMoodleApiError(error)) return error.category;
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'timeout';
  }
  return 'upstream';
}

function apiErrorCode(error: unknown): string {
  if (isMoodleApiError(error)) return error.publicCode;
  return 'UPSTREAM_ERROR';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new MoodleApiError({ category: 'timeout' }));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export class EclassHybridProvider implements EclassScraperDependency {
  private readonly playwright: EclassScraperDependency;
  private readonly tokenFiles?: TokenFileSource;
  private readonly apiClient?: ApiReader;
  private readonly restClient?: RestReader;
  private readonly hasMobileCredential: () => boolean;
  private readonly apiSessionContext?: Pick<EclassApiSessionContext, 'close'>;
  private readonly closeOwnedResources?: () => Promise<void>;
  private readonly mode: EclassSourceMode;
  private readonly origin: string;
  private readonly shadowTimeoutMs: number;

  constructor(options: EclassHybridProviderOptions) {
    const config = getEclassApiConfig();
    this.playwright = options.playwright;
    this.tokenFiles = options.tokenFiles;
    this.apiClient = options.apiClient;
    this.restClient = options.restClient;
    this.hasMobileCredential = options.hasMobileCredential ?? (() => true);
    this.apiSessionContext = options.apiSessionContext;
    this.closeOwnedResources = options.closeOwnedResources;
    this.mode = options.mode ?? config.sourceMode;
    this.origin = options.origin ?? config.origin;
    this.shadowTimeoutMs = options.shadowTimeoutMs ?? DEFAULT_SHADOW_TIMEOUT_MS;
  }

  async getCourses(): Promise<Course[]> {
    return this.runRead(
      'courses',
      this.apiClient || this.restUsable() ? () => this.apiCourses() : null,
      () => this.playwright.getCourses(),
      compareCourseCanary
    );
  }

  async getCourseContent(courseId: string): Promise<CourseContent> {
    return this.runRead(
      'course_content',
      this.apiClient || this.restUsable()
        ? () => this.apiCourseContent(courseId)
        : null,
      () => this.playwright.getCourseContent(courseId),
      compareCourseContentCanary
    );
  }

  async getDeadlines(courseId?: string): Promise<Assignment[]> {
    return this.runRead(
      'deadlines',
      this.apiClient || this.restUsable()
        ? () => this.apiDeadlines(courseId)
        : null,
      () => this.playwright.getDeadlines(courseId),
      compareDeadlineCanary
    );
  }

  async getAllAssignmentDeadlines(courseId?: string): Promise<DeadlineItem[]> {
    return this.runRead(
      'assignment_index',
      this.restUsable() ? () => this.restAssignments(courseId) : null,
      () => this.playwright.getAllAssignmentDeadlines(courseId),
      compareAssignmentIndexCanary
    );
  }

  getItemDetails(url: string): Promise<ItemDetails> {
    return this.playwright.getItemDetails(url);
  }

  getAssignmentSubmissionPreflight(
    url: string
  ): Promise<AssignmentSubmissionPreflightData> {
    return this.playwright.getAssignmentSubmissionPreflight(url);
  }

  async getGrades(courseId?: string): Promise<Grade[]> {
    return this.runRead(
      'grades',
      this.restUsable() ? () => this.restGrades(courseId) : null,
      () => this.playwright.getGrades(courseId),
      compareGradeCanary
    );
  }

  async getAnnouncements(
    courseId?: string,
    limit: number = 10
  ): Promise<Announcement[]> {
    const cid = courseId?.trim();
    // Site-level news has no course id to resolve a news forum from.
    return this.runRead(
      'announcements',
      cid && this.restUsable()
        ? () => this.restAnnouncements(cid, limit)
        : null,
      () => this.playwright.getAnnouncements(courseId, limit),
      compareAnnouncementCanary
    );
  }

  /**
   * Token download first when a mobile credential exists and the URL is a
   * pluginfile (ADR 0011); any failure falls back to the Playwright download,
   * which also handles wrapper pages such as `/mod/resource/view.php`.
   */
  async downloadFile(fileUrl: string): Promise<DownloadedFile> {
    if (this.tokenFiles) {
      try {
        const file = await this.tokenFiles.download(fileUrl);
        if (file) return file;
      } catch (error) {
        this.logFallback('file_download', error);
      }
    }
    return this.playwright.downloadFile(fileUrl);
  }

  getSectionText(url: string): Promise<SectionTextData> {
    return this.playwright.getSectionText(url);
  }

  async close(): Promise<void> {
    await this.apiSessionContext?.close();
    await this.closeOwnedResources?.();
  }

  private restUsable(): boolean {
    return this.restClient !== undefined && this.hasMobileCredential();
  }

  /**
   * Session AJAX first (list_courses and deadlines stay on AJAX); the token
   * REST read is the fallback for when the cookie session has lapsed. When
   * both fail, the AJAX error is the one reported.
   */
  private async withRestFallback<T>(
    operation: string,
    ajaxRead: (() => Promise<T>) | null,
    restRead: (() => Promise<T>) | null
  ): Promise<T> {
    if (!ajaxRead) return restRead!();
    try {
      return await ajaxRead();
    } catch (error) {
      if (
        !restRead ||
        (isMoodleApiError(error) && error.category === 'rate_limited')
      ) {
        throw error;
      }
      this.logFallback(operation, error, 'rest');
      try {
        return await restRead();
      } catch {
        throw error;
      }
    }
  }

  /** Token REST first, session AJAX second. */
  private async withAjaxFallback<T>(
    operation: string,
    restRead: (() => Promise<T>) | null,
    ajaxRead: (() => Promise<T>) | null
  ): Promise<T> {
    if (!restRead) return ajaxRead!();
    try {
      return await restRead();
    } catch (error) {
      if (!ajaxRead || !isFallbackEligible(error)) throw error;
      this.logFallback(operation, error, 'ajax');
      return ajaxRead();
    }
  }

  private async apiCourses(): Promise<Course[]> {
    return this.withRestFallback(
      'courses',
      this.apiClient
        ? async () => {
            const data: MoodleEnrolledCoursesData =
              await this.apiClient!.getEnrolledCourses();
            return mapMoodleCourses(data, this.origin);
          }
        : null,
      this.restUsable() ? () => this.restCourses() : null
    );
  }

  private async restCourses(): Promise<Course[]> {
    return mapRestUserCourses(
      await this.restClient!.getUserCourses(),
      this.origin
    );
  }

  private async apiCourseContent(courseId: string): Promise<CourseContent> {
    return this.withAjaxFallback(
      'course_content',
      this.restUsable()
        ? async () =>
            mapRestCourseContents(
              await this.restClient!.getCourseContents(courseId),
              courseId,
              this.origin
            )
        : null,
      this.apiClient
        ? async () => {
            const state: MoodleCourseFormatState =
              await this.apiClient!.getCourseFormatState(courseId);
            if (!isMoodleCourseContentComplete(state)) {
              throw new MoodleApiError({
                category: 'malformed_response',
                upstreamCode: 'incomplete_course_format_state',
              });
            }
            return mapMoodleCourseContent(state, courseId, this.origin);
          }
        : null
    );
  }

  private async apiDeadlines(courseId?: string): Promise<Assignment[]> {
    const timesort = {
      timesortfrom: Math.floor(Date.now() / 1000),
      limitnum: 50,
    };
    return this.withRestFallback(
      'deadlines',
      this.apiClient
        ? async () => {
            const calendar: MoodleCalendarData = courseId
              ? await this.apiClient!.getCalendarUpcoming(courseId)
              : await this.apiClient!.getCalendarActionEventsByTimesort(
                  timesort
                );
            return mapMoodleCalendarToAssignments(calendar, this.origin);
          }
        : null,
      this.restUsable()
        ? async () => {
            const calendar =
              await this.restClient!.getActionEventsByTimesort(timesort);
            const mapped = mapMoodleCalendarToAssignments(
              calendar,
              this.origin
            );
            return courseId
              ? mapped.filter((item) => item.courseId === courseId)
              : mapped;
          }
        : null
    );
  }

  private async restAssignments(courseId?: string): Promise<DeadlineItem[]> {
    const courseIds = courseId
      ? [courseId]
      : (await this.restCourses()).map((course) => course.id);
    if (courseIds.length === 0) return [];
    const data = await this.restClient!.getAssignments(courseIds);
    const assignIds = data.courses.flatMap((course) =>
      course.assignments.map((assignment) => String(assignment.id))
    );
    const statuses = await mapWithConcurrency(
      assignIds,
      SUBMISSION_STATUS_CONCURRENCY,
      async (assignId): Promise<MoodleRestSubmissionStatus | null> => {
        try {
          return await this.restClient!.getSubmissionStatus(assignId);
        } catch (error) {
          // One unreadable status should not hide the assignment itself.
          if (!isFallbackEligible(error)) throw error;
          return null;
        }
      }
    );
    return mapRestAssignments(
      data,
      this.origin,
      new Map(assignIds.map((id, index) => [id, statuses[index] ?? null]))
    );
  }

  private async restGrades(courseId?: string): Promise<Grade[]> {
    const cid = courseId?.trim();
    if (cid) {
      return mapRestGradeItems(await this.restClient!.getGradeItems(cid));
    }
    const [overview, courses] = await Promise.all([
      this.restClient!.getOverviewGrades(),
      this.restCourses().catch(() => [] as Course[]),
    ]);
    return mapRestOverviewGrades(overview, courses);
  }

  private async restAnnouncements(
    courseId: string,
    limit: number
  ): Promise<Announcement[]> {
    const forums = await this.restClient!.getForums([courseId]);
    const news = forums.find(
      (forum) => forum.type === 'news' && String(forum.course) === courseId
    );
    if (!news) return [];
    const discussions = await this.restClient!.getForumDiscussions(
      news.id,
      limit
    );
    return mapRestForumDiscussions(discussions, this.origin, limit);
  }

  private async runRead<T>(
    operation: string,
    apiRead: (() => Promise<T>) | null,
    playwrightRead: () => Promise<T>,
    compare: ShadowComparator<T>
  ): Promise<T> {
    if (this.mode === 'playwright' || !apiRead) {
      return playwrightRead();
    }
    if (this.mode === 'api') {
      return this.runApiPrimary(operation, apiRead, playwrightRead);
    }
    return this.runShadow(operation, apiRead, playwrightRead, compare);
  }

  private async runApiPrimary<T>(
    operation: string,
    apiRead: () => Promise<T>,
    playwrightRead: () => Promise<T>
  ): Promise<T> {
    let apiError: unknown;
    try {
      return await apiRead();
    } catch (error) {
      apiError = error;
      if (!isFallbackEligible(error)) throw error;
      this.logFallback(operation, error);
    }

    try {
      return await playwrightRead();
    } catch (playwrightError) {
      if (playwrightError instanceof Error) {
        throw playwrightError;
      }
      if (apiError !== undefined) throw apiError;
      throw playwrightError;
    }
  }

  private async runShadow<T>(
    operation: string,
    apiRead: () => Promise<T>,
    playwrightRead: () => Promise<T>,
    compare: ShadowComparator<T>
  ): Promise<T> {
    const startedAt = Date.now();
    const [apiResult, playwrightResult] = await Promise.allSettled([
      withTimeout(apiRead(), this.shadowTimeoutMs),
      playwrightRead(),
    ]);

    if (playwrightResult.status === 'rejected') {
      throw playwrightResult.reason;
    }

    if (apiResult.status === 'rejected') {
      const safeError = serializeApiErrorForLog(apiResult.reason);
      getLogger().warn(
        createSafeApiLogFields({
          operation,
          source: 'shadow',
          endpointPath: `/hybrid/${operation}`,
          durationMs: Date.now() - startedAt,
          errorCode: safeError.errorCode || apiFailureReason(apiResult.reason),
        }),
        'eClass API shadow read failed'
      );
      return playwrightResult.value;
    }

    const comparison = compare(apiResult.value, playwrightResult.value);
    const level = comparison.mismatchCategories.length > 0 ? 'warn' : 'info';
    getLogger()[level](
      createSafeApiLogFields({
        operation,
        source: 'shadow',
        endpointPath: `/hybrid/${operation}`,
        durationMs: Date.now() - startedAt,
        ...(comparison.mismatchCategories.length > 0
          ? { fallbackReason: comparison.mismatchCategories.join(',') }
          : {}),
      }),
      comparison.mismatchCategories.length > 0
        ? 'eClass API shadow mismatch'
        : 'eClass API shadow match'
    );
    return playwrightResult.value;
  }

  private logFallback(
    operation: string,
    error: unknown,
    target: FallbackTarget = 'playwright'
  ): void {
    const safeError = serializeApiErrorForLog(error);
    getLogger().warn(
      createSafeApiLogFields({
        operation,
        source: 'api',
        endpointPath: `/hybrid/${operation}`,
        durationMs: 0,
        fallback: true,
        fallbackReason: apiFailureReason(error),
        errorCode: safeError.errorCode || apiErrorCode(error),
      }),
      FALLBACK_MESSAGES[target]
    );
  }
}
