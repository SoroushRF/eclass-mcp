import { z } from 'zod';
import { ECLASS_AJAX_METHODS, getEclassApiConfig } from './constants';
import { isMoodleApiError, MoodleApiError } from './errors';
import { PlaywrightMoodleTransport, type MoodleTransport } from './transport';
import type { EclassApiSession } from './session-context';
import {
  MoodleAjaxResponseSchema,
  MoodleCalendarDataSchema,
  MoodleCourseFormatStateSchema,
  MoodleEnrolledCoursesDataSchema,
  type MoodleAjaxCall,
  type MoodleCalendarData,
  type MoodleCourseFormatState,
  type MoodleEnrolledCoursesData,
} from './types';

export const PROVEN_MOODLE_AJAX_METHODS = [
  ECLASS_AJAX_METHODS.enrolledCourses,
  ECLASS_AJAX_METHODS.courseFormatState,
  ECLASS_AJAX_METHODS.calendarUpcoming,
  ECLASS_AJAX_METHODS.calendarActionEvents,
] as const;

export type ProvenMoodleAjaxMethod =
  (typeof PROVEN_MOODLE_AJAX_METHODS)[number];

export interface MoodleAjaxSessionProvider {
  getSession(): Promise<EclassApiSession>;
  refresh(): Promise<EclassApiSession>;
}

export interface MoodleAjaxClientOptions {
  sessionContext: MoodleAjaxSessionProvider;
  origin?: string;
  timeoutMs?: number;
  transportFactory?: (session: EclassApiSession) => MoodleTransport;
}

function isProvenMethod(value: string): value is ProvenMoodleAjaxMethod {
  return (PROVEN_MOODLE_AJAX_METHODS as readonly string[]).includes(value);
}

function assertCourseId(courseId: string | number): number {
  const parsed = Number(courseId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MoodleApiError({ category: 'malformed_response' });
  }
  return parsed;
}

function parseAjaxEnvelope(value: unknown): unknown {
  const parsed = MoodleAjaxResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.length === 0) {
    throw new MoodleApiError({ category: 'malformed_response' });
  }

  const entry = parsed.data[0];
  if (entry.error) {
    const errorCode = entry.errorcode?.toLowerCase();
    if (
      errorCode === 'invalidsesskey' ||
      errorCode === 'invalid_session' ||
      errorCode === 'requireloginerror'
    ) {
      throw new MoodleApiError({
        category: 'session_invalid',
        upstreamCode: errorCode,
      });
    }
    if (errorCode === 'servicenotavailable') {
      throw new MoodleApiError({
        category: 'capability_unavailable',
        upstreamCode: errorCode,
      });
    }
    if (errorCode === 'invalidtoken') {
      throw new MoodleApiError({
        category: 'mobile_token_invalid',
        upstreamCode: errorCode,
      });
    }
    throw new MoodleApiError({
      category: 'upstream',
      upstreamCode: errorCode,
    });
  }

  if (!('data' in entry)) {
    throw new MoodleApiError({ category: 'malformed_response' });
  }
  return entry.data;
}

function parseData<T>(value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MoodleApiError({ category: 'malformed_response' });
  }
  return parsed.data;
}

function parseCourseFormatState(value: unknown): MoodleCourseFormatState {
  if (typeof value !== 'string') {
    return parseData(value, MoodleCourseFormatStateSchema);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (cause) {
    throw new MoodleApiError({
      category: 'malformed_response',
      cause,
    });
  }
  return parseData(parsed, MoodleCourseFormatStateSchema);
}

export class MoodleAjaxClient {
  private readonly sessionContext: MoodleAjaxSessionProvider;
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly transportFactory: (
    session: EclassApiSession
  ) => MoodleTransport;
  private transportSession: EclassApiSession | null = null;
  private transport: MoodleTransport | null = null;

  constructor(options: MoodleAjaxClientOptions) {
    const config = getEclassApiConfig();
    this.sessionContext = options.sessionContext;
    this.origin = options.origin ?? config.origin;
    this.timeoutMs = options.timeoutMs ?? config.timeoutMs;
    this.transportFactory =
      options.transportFactory ??
      ((session) =>
        new PlaywrightMoodleTransport({
          request: session.request,
          origin: this.origin,
          timeoutMs: this.timeoutMs,
        }));
  }

  async getEnrolledCourses(): Promise<MoodleEnrolledCoursesData> {
    const data = await this.call(ECLASS_AJAX_METHODS.enrolledCourses, {
      classification: 'all',
      limit: 0,
      offset: 0,
      sort: 'fullname',
    });
    return parseData(data, MoodleEnrolledCoursesDataSchema);
  }

  async getCourseFormatState(
    courseId: string | number
  ): Promise<MoodleCourseFormatState> {
    const data = await this.call(ECLASS_AJAX_METHODS.courseFormatState, {
      courseid: assertCourseId(courseId),
    });
    return parseCourseFormatState(data);
  }

  async getCalendarUpcoming(
    courseId: string | number = 1
  ): Promise<MoodleCalendarData> {
    const data = await this.call(ECLASS_AJAX_METHODS.calendarUpcoming, {
      courseid: assertCourseId(courseId),
    });
    return parseData(data, MoodleCalendarDataSchema);
  }

  async getCalendarActionEventsByTimesort(options: {
    timesortfrom: number;
    timesortto?: number;
    limitnum?: number;
    courseid?: string | number;
  }): Promise<MoodleCalendarData> {
    const args: Record<string, unknown> = {
      timesortfrom: Math.floor(options.timesortfrom),
      limitnum: Math.floor(options.limitnum ?? 50),
    };
    if (options.timesortto !== undefined) {
      args.timesortto = Math.floor(options.timesortto);
    }
    if (options.courseid !== undefined) {
      args.courseid = assertCourseId(options.courseid);
    }
    const data = await this.call(
      ECLASS_AJAX_METHODS.calendarActionEvents,
      args
    );
    return parseData(data, MoodleCalendarDataSchema);
  }

  async call(
    methodname: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!isProvenMethod(methodname)) {
      throw new MoodleApiError({
        category: 'capability_unavailable',
        upstreamCode: 'method_not_allowlisted',
      });
    }

    const call: MoodleAjaxCall = {
      index: 0,
      methodname,
      args,
    };

    let refreshed = false;
    while (true) {
      const session = await this.sessionContext.getSession();
      const transport = this.getTransport(session);
      try {
        const response = await transport.postAjax([call], session.sesskey);
        return parseAjaxEnvelope(response);
      } catch (error) {
        if (
          !refreshed &&
          isMoodleApiError(error) &&
          error.category === 'session_invalid'
        ) {
          refreshed = true;
          await this.sessionContext.refresh();
          this.transport = null;
          this.transportSession = null;
          continue;
        }
        throw error;
      }
    }
  }

  private getTransport(session: EclassApiSession): MoodleTransport {
    if (this.transport && this.transportSession === session) {
      return this.transport;
    }
    this.transportSession = session;
    this.transport = this.transportFactory(session);
    return this.transport;
  }
}
