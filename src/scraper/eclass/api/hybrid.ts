import { getLogger } from '../../../logging/context';
import {
  createSafeApiLogFields,
  serializeApiErrorForLog,
} from '../../../logging/api-safe';
import { getEclassApiConfig, type EclassSourceMode } from './constants';
import {
  compareCourseCanary,
  compareCourseContentCanary,
  compareDeadlineCanary,
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
import type {
  MoodleCalendarData,
  MoodleCourseFormatState,
  MoodleEnrolledCoursesData,
} from './types';
import type { EclassApiSessionContext } from './session-context';
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

type ShadowComparator<T> = (
  apiValue: T,
  playwrightValue: T
) => HybridCanaryComparison;

export interface EclassHybridProviderOptions {
  playwright: EclassScraperDependency;
  apiClient?: ApiReader;
  apiSessionContext?: Pick<EclassApiSessionContext, 'close'>;
  closeOwnedResources?: () => Promise<void>;
  mode?: EclassSourceMode;
  origin?: string;
  shadowTimeoutMs?: number;
}

const DEFAULT_SHADOW_TIMEOUT_MS = 2_000;

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

export class EclassHybridProvider implements EclassScraperDependency {
  private readonly playwright: EclassScraperDependency;
  private readonly apiClient?: ApiReader;
  private readonly apiSessionContext?: Pick<EclassApiSessionContext, 'close'>;
  private readonly closeOwnedResources?: () => Promise<void>;
  private readonly mode: EclassSourceMode;
  private readonly origin: string;
  private readonly shadowTimeoutMs: number;

  constructor(options: EclassHybridProviderOptions) {
    const config = getEclassApiConfig();
    this.playwright = options.playwright;
    this.apiClient = options.apiClient;
    this.apiSessionContext = options.apiSessionContext;
    this.closeOwnedResources = options.closeOwnedResources;
    this.mode = options.mode ?? config.sourceMode;
    this.origin = options.origin ?? config.origin;
    this.shadowTimeoutMs = options.shadowTimeoutMs ?? DEFAULT_SHADOW_TIMEOUT_MS;
  }

  async getCourses(): Promise<Course[]> {
    return this.runRead(
      'courses',
      () => this.apiCourses(),
      () => this.playwright.getCourses(),
      compareCourseCanary
    );
  }

  async getCourseContent(courseId: string): Promise<CourseContent> {
    return this.runRead(
      'course_content',
      () => this.apiCourseContent(courseId),
      () => this.playwright.getCourseContent(courseId),
      compareCourseContentCanary
    );
  }

  async getDeadlines(courseId?: string): Promise<Assignment[]> {
    return this.runRead(
      'deadlines',
      () => this.apiDeadlines(courseId),
      () => this.playwright.getDeadlines(courseId),
      compareDeadlineCanary
    );
  }

  async getAllAssignmentDeadlines(courseId?: string): Promise<DeadlineItem[]> {
    return this.playwright.getAllAssignmentDeadlines(courseId);
  }

  getItemDetails(url: string): Promise<ItemDetails> {
    return this.playwright.getItemDetails(url);
  }

  getAssignmentSubmissionPreflight(
    url: string
  ): Promise<AssignmentSubmissionPreflightData> {
    return this.playwright.getAssignmentSubmissionPreflight(url);
  }

  getGrades(courseId?: string): Promise<Grade[]> {
    return this.playwright.getGrades(courseId);
  }

  getAnnouncements(
    courseId?: string,
    limit: number = 10
  ): Promise<Announcement[]> {
    return this.playwright.getAnnouncements(courseId, limit);
  }

  downloadFile(fileUrl: string) {
    return this.playwright.downloadFile(fileUrl);
  }

  getSectionText(url: string): Promise<SectionTextData> {
    return this.playwright.getSectionText(url);
  }

  async close(): Promise<void> {
    await this.apiSessionContext?.close();
    await this.closeOwnedResources?.();
  }

  private async apiCourses(): Promise<Course[]> {
    if (!this.apiClient) {
      throw new MoodleApiError({ category: 'capability_unavailable' });
    }
    const data: MoodleEnrolledCoursesData =
      await this.apiClient.getEnrolledCourses();
    return mapMoodleCourses(data, this.origin);
  }

  private async apiCourseContent(courseId: string): Promise<CourseContent> {
    if (!this.apiClient) {
      throw new MoodleApiError({ category: 'capability_unavailable' });
    }
    const state: MoodleCourseFormatState =
      await this.apiClient.getCourseFormatState(courseId);
    if (!isMoodleCourseContentComplete(state)) {
      throw new MoodleApiError({
        category: 'malformed_response',
        upstreamCode: 'incomplete_course_format_state',
      });
    }
    return mapMoodleCourseContent(state, courseId, this.origin);
  }

  private async apiDeadlines(courseId?: string): Promise<Assignment[]> {
    if (!this.apiClient) {
      throw new MoodleApiError({ category: 'capability_unavailable' });
    }
    const calendar: MoodleCalendarData = courseId
      ? await this.apiClient.getCalendarUpcoming(courseId)
      : await this.apiClient.getCalendarActionEventsByTimesort({
          timesortfrom: Math.floor(Date.now() / 1000),
          limitnum: 50,
        });
    return mapMoodleCalendarToAssignments(calendar, this.origin);
  }

  private async runRead<T>(
    operation: string,
    apiRead: () => Promise<T>,
    playwrightRead: () => Promise<T>,
    compare: ShadowComparator<T>
  ): Promise<T> {
    if (this.mode === 'playwright' || !this.apiClient) {
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

  private logFallback(operation: string, error: unknown): void {
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
      'eClass API read falling back to Playwright'
    );
  }
}
