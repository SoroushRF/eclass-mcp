import {
  clearMobileCredential,
  loadMobileCredential,
  type MobileCredential,
} from '../../session';
import { MoodleApiError } from './errors';
import type { MoodleTransport } from './transport';
import {
  MoodleRestAssignmentsDataSchema,
  MoodleRestCourseContentsSchema,
  MoodleRestErrorEnvelopeSchema,
  MoodleRestForumsDataSchema,
  MoodleRestGradeItemsDataSchema,
  MoodleRestSiteInfoSchema,
  type MoodleRestCourseContents,
} from './types';

export const MOODLE_REST_CAPABILITIES = {
  siteInfo: 'core_webservice_get_site_info',
  courseContents: 'core_course_get_contents',
  assignments: 'mod_assign_get_assignments',
  forums: 'mod_forum_get_forums_by_courses',
  gradeItems: 'gradereport_user_get_grade_items',
  pluginFiles: 'core_files_get_files',
} as const;

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
  if (errorCode === 'servicenotavailable') {
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
    const raw = await this.callRaw(
      MOODLE_REST_CAPABILITIES.siteInfo,
      {},
      true
    );
    const parsed = MoodleRestSiteInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }
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
    const raw = await this.callCapability(
      MOODLE_REST_CAPABILITIES.courseContents,
      { courseid: Number(courseId) }
    );
    const parsed = MoodleRestCourseContentsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }
    return parsed.data;
  }

  async getAssignments(courseIds: readonly (string | number)[]): Promise<unknown> {
    const raw = await this.callCapability(
      MOODLE_REST_CAPABILITIES.assignments,
      { courseids: courseIds.map(Number) }
    );
    const parsed = MoodleRestAssignmentsDataSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }
    return parsed.data;
  }

  async getForums(courseIds: readonly (string | number)[]): Promise<unknown> {
    const raw = await this.callCapability(
      MOODLE_REST_CAPABILITIES.forums,
      { courseids: courseIds.map(Number) }
    );
    const parsed = MoodleRestForumsDataSchema.safeParse(raw);
    if (!parsed.success) {
      throw new MoodleApiError({ category: 'malformed_response' });
    }
    return parsed.data;
  }

  async getGradeItems(courseId?: string | number): Promise<unknown> {
    const raw = await this.callCapability(
      MOODLE_REST_CAPABILITIES.gradeItems,
      courseId === undefined ? {} : { courseid: Number(courseId) }
    );
    const parsed = MoodleRestGradeItemsDataSchema.safeParse(raw);
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
    error instanceof MoodleApiError &&
    error.category === 'mobile_token_invalid'
  );
}
