import {
  UpstreamError,
  upstreamErrorFromHttpStatus,
  upstreamErrorFromUnknown,
} from './scrape-errors';
import { getLogger, logTraceEvent, runWithSpan } from '../logging/context';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitBreakerEvent,
} from '../runtime/circuit-breaker';

/**
 * RMP API Client for GraphQL interactions
 */
export interface RMPTeacherSearch {
  id: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  department: string;
  school: {
    name: string;
    id: string;
  };
}

export interface RMPRating {
  comment: string;
  date: string;
  class: string;
  clarityRating: number;
  helpfulRating: number;
  difficultyRating: number;
  grade: string;
  wouldTakeAgain: number | null;
  ratingTags: string;
}

export interface RMPTeacherDetails {
  id: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  wouldTakeAgainPercent: number;
  department: string;
  school: {
    name: string;
    id: string;
  };
  ratings: RMPRating[];
}

export interface RMPSearchDiagnostics {
  normalizedName: string;
  campus: 'Keele' | 'Glendon' | 'Markham' | null;
  requestedSchoolIds: string[];
  directMatchCount: number;
  usedCrossCampusProbe: boolean;
  crossCampusMatchCount: number;
  suspectedSchoolIdIssue: boolean;
  note?: string;
  attempts: Array<{
    schoolId: string;
    term: string;
  }>;
}

export interface RMPSearchReport {
  matches: RMPTeacherSearch[];
  diagnostics: RMPSearchDiagnostics;
}

export const YORK_SCHOOL_IDS = {
  // Live school IDs observed from the browser Network tab on 2026-03-23.
  KEELE: 'U2Nob29sLTE0OTU=',
  GLENDON: 'U2Nob29sLTEyMTI1',
  MARKHAM: 'U2Nob29sLTE5Mzcy',
};

interface RMPTeacherEdge {
  node: RMPTeacherSearch;
}

interface RMPTeacherSearchResponse {
  newSearch?: {
    teachers?: {
      edges?: RMPTeacherEdge[];
    };
  };
}

interface RMPRatingEdge {
  node: RMPRating;
}

interface RMPTeacherDetailsNode extends Omit<RMPTeacherDetails, 'ratings'> {
  __typename?: string;
  ratings?: {
    edges?: RMPRatingEdge[];
  };
}

interface RMPTeacherDetailsResponse {
  node?: RMPTeacherDetailsNode | null;
}

interface GraphQLPayload {
  operationName?: string;
  variables: Record<string, unknown>;
}

export const DEFAULT_RMP_TIMEOUT_MS = 15000;
export const RMP_CIRCUIT_FAILURE_THRESHOLD = 3;
export const RMP_CIRCUIT_COOLDOWN_MS = 60_000;

function logRmpCircuitEvent(circuitEvent: CircuitBreakerEvent): void {
  const { event, ...fields } = circuitEvent;
  const level =
    event === 'circuit_open' || event === 'circuit_blocked' ? 'warn' : 'info';
  logTraceEvent(level, event, fields, '[RMP] circuit breaker event');
}

const rmpCircuitBreaker = new CircuitBreaker({
  name: 'rmp',
  failureThreshold: RMP_CIRCUIT_FAILURE_THRESHOLD,
  cooldownMs: RMP_CIRCUIT_COOLDOWN_MS,
  onEvent: logRmpCircuitEvent,
});

export function resetRmpCircuitBreaker(): void {
  rmpCircuitBreaker.reset();
}

export function getRmpCircuitBreakerSnapshot() {
  return rmpCircuitBreaker.snapshot();
}

export function resolveRmpTimeoutMs(
  raw: string | undefined = process.env.ECLASS_MCP_RMP_TIMEOUT_MS
): number {
  if (!raw || raw.trim() === '') {
    return DEFAULT_RMP_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_RMP_TIMEOUT_MS;
}

function normalizeQueryText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function isRmpCircuitBreakerFailure(error: unknown): boolean {
  return (
    error instanceof UpstreamError &&
    (error.code === 'RATE_LIMITED' ||
      error.code === 'TIMEOUT' ||
      error.code === 'UPSTREAM_ERROR')
  );
}

function rmpCircuitOpenError(error: CircuitBreakerOpenError): UpstreamError {
  const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
  return new UpstreamError(
    'RATE_LIMITED',
    `RMP requests are temporarily paused after repeated upstream failures. Retry after ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
    undefined,
    error
  );
}

export class RMPClient {
  private endpoint = 'https://www.ratemyprofessors.com/graphql';
  private auth = 'Basic dGVzdDp0ZXN0';
  private headers = {
    Authorization: this.auth,
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Referer: 'https://www.ratemyprofessors.com/',
  };

  /**
   * Search for teachers by name across all or specific York campuses
   */
  async searchTeachers(
    name: string,
    campus?: 'Keele' | 'Glendon' | 'Markham'
  ): Promise<RMPTeacherSearch[]> {
    const report = await this.searchTeachersWithDiagnostics(name, campus);
    return report.matches;
  }

  async searchTeachersWithDiagnostics(
    name: string,
    campus?: 'Keele' | 'Glendon' | 'Markham'
  ): Promise<RMPSearchReport> {
    const normalizedName = normalizeQueryText(name);
    const fallbackTerm = normalizedName.includes(' ')
      ? normalizedName.split(' ').filter(Boolean).slice(-1)[0]
      : '';
    const query = `
        query NewSearchTeachersQuery($query: TeacherSearchQuery!, $count: Int) {
          newSearch {
            teachers(query: $query, first: $count) {
              didFallback
              edges {
                cursor
                node {
                  id
                  legacyId
                  firstName
                  lastName
                  department
                  departmentId
                  school {
                    legacyId
                    name
                    id
                  }
                }
              }
            }
          }
        }
        `;

    const terms =
      fallbackTerm && fallbackTerm !== normalizedName
        ? [normalizedName, fallbackTerm]
        : [normalizedName];

    const requestedSchoolIds = campus
      ? [this.getSchoolId(campus)]
      : Object.values(YORK_SCHOOL_IDS);
    const direct = await this.searchTeachersAcrossSchools(
      query,
      terms,
      requestedSchoolIds,
      normalizedName,
      campus || null
    );

    const diagnostics: RMPSearchDiagnostics = {
      normalizedName,
      campus: campus || null,
      requestedSchoolIds,
      directMatchCount: direct.length,
      usedCrossCampusProbe: false,
      crossCampusMatchCount: 0,
      suspectedSchoolIdIssue: false,
      attempts: requestedSchoolIds.flatMap((schoolId) =>
        terms.map((term) => ({ schoolId, term }))
      ),
    };

    if (campus && direct.length === 0) {
      const probeSchoolIds = Object.values(YORK_SCHOOL_IDS);
      const probe = await this.searchTeachersAcrossSchools(
        query,
        terms,
        probeSchoolIds,
        normalizedName,
        null
      );

      diagnostics.usedCrossCampusProbe = true;
      diagnostics.crossCampusMatchCount = probe.length;
      diagnostics.suspectedSchoolIdIssue = probe.length > 0;
      diagnostics.note =
        probe.length > 0
          ? `Requested campus "${campus}" returned 0 matches, but a cross-campus probe found results. The campus school ID may be stale or the campus filter may not match the live browser request.`
          : `Requested campus "${campus}" returned 0 matches, and the cross-campus probe also returned 0. That usually means no match for the current query text.`;

      const matches = probe.length > 0 ? probe : direct;
      getLogger().debug(
        {
          normalizedName,
          campus,
          direct: 0,
          crossCampus: probe.length,
        },
        '[RMP] searchTeachers done'
      );
      return { matches, diagnostics };
    }

    getLogger().debug(
      {
        normalizedName,
        campus: campus || 'all',
        total: direct.length,
      },
      '[RMP] searchTeachers done'
    );
    return { matches: direct, diagnostics };
  }

  private getSchoolId(campus: 'Keele' | 'Glendon' | 'Markham'): string {
    const key = campus.toUpperCase() as keyof typeof YORK_SCHOOL_IDS;
    return YORK_SCHOOL_IDS[key];
  }

  private async searchTeachersAcrossSchools(
    query: string,
    terms: string[],
    schoolIds: string[],
    normalizedName: string,
    campus: 'Keele' | 'Glendon' | 'Markham' | null
  ): Promise<RMPTeacherSearch[]> {
    const resultsById = new Map<string, RMPTeacherSearch>();

    getLogger().debug(
      {
        normalizedName,
        campus: campus || 'all',
        schools: schoolIds.length,
      },
      '[RMP] searchTeachers start'
    );

    for (const schoolId of schoolIds) {
      for (const [index, term] of terms.entries()) {
        getLogger().debug(
          {
            schoolId,
            term,
            attempt: index + 1,
            attempts: terms.length,
          },
          '[RMP] querying'
        );

        const data = await this.fetchGraphQL<RMPTeacherSearchResponse>(query, {
          operationName: 'NewSearchTeachersQuery',
          variables: {
            query: { text: term.toLowerCase(), schoolID: schoolId },
            count: 10,
          },
        });
        const teachers = data.data?.newSearch?.teachers?.edges ?? [];
        if (teachers.length === 0) {
          getLogger().debug(
            { schoolId, term },
            '[RMP] no matches for schoolId/term'
          );
          continue;
        }

        for (const t of teachers) {
          const node = t.node;
          if (!resultsById.has(node.id)) {
            resultsById.set(node.id, node);
          }
        }

        getLogger().debug(
          { schoolId, term, count: teachers.length },
          '[RMP] found matches'
        );
        break;
      }
    }

    return Array.from(resultsById.values());
  }

  /**
   * Get detailed ratings and comments for a teacher
   */
  async getTeacherDetails(
    teacherId: string
  ): Promise<RMPTeacherDetails | null> {
    const query = `
        query TeacherRatingsPageQuery($id: ID!) {
          node(id: $id) {
            __typename
            ... on Teacher {
              id
              legacyId
              firstName
              lastName
              avgRating
              avgDifficulty
              numRatings
              wouldTakeAgainPercent
              department
              school {
                name
                id
              }
              ratings(first: 20) {
                edges {
                  node {
                    comment
                    date
                    class
                    clarityRating
                    helpfulRating
                    difficultyRating
                    grade
                    wouldTakeAgain
                    ratingTags
                  }
                }
              }
            }
          }
        }
        `;

    const data = await this.fetchGraphQL<RMPTeacherDetailsResponse>(query, {
      operationName: 'TeacherRatingsPageQuery',
      variables: { id: teacherId },
    });
    const teacher = data.data?.node;

    if (!teacher || teacher.__typename !== 'Teacher') {
      getLogger().debug(
        { teacherId },
        '[RMP] teacher details missing or wrong type'
      );
      return null;
    }

    return {
      id: teacher.id,
      legacyId: teacher.legacyId,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      avgRating: teacher.avgRating,
      avgDifficulty: teacher.avgDifficulty,
      numRatings: teacher.numRatings,
      wouldTakeAgainPercent: teacher.wouldTakeAgainPercent,
      department: teacher.department,
      school: teacher.school,
      ratings: (teacher.ratings?.edges ?? []).map((e) => e.node),
    };
  }

  private async fetchGraphQL<TData>(
    query: string,
    payload: GraphQLPayload
  ): Promise<{ data?: TData; errors?: Array<{ message?: string }> }> {
    const timeoutMs = resolveRmpTimeoutMs();
    const operationName = payload.operationName ?? 'anonymous';
    return runWithSpan(
      'rmp.graphql',
      async () => {
        try {
          return await rmpCircuitBreaker.execute(
            () => this.fetchGraphQLOnce(query, payload, timeoutMs),
            { shouldRecordFailure: isRmpCircuitBreakerFailure }
          );
        } catch (error) {
          if (error instanceof CircuitBreakerOpenError) {
            getLogger().warn(
              { err: error, retryAfterMs: error.retryAfterMs },
              '[RMP] circuit breaker blocked request'
            );
            throw rmpCircuitOpenError(error);
          }
          throw error;
        }
      },
      {
        component: 'rmp',
        fields: {
          operationName,
          timeoutMs,
          circuitState: rmpCircuitBreaker.snapshot().state,
        },
      }
    );
  }

  private async fetchGraphQLOnce<TData>(
    query: string,
    payload: GraphQLPayload,
    timeoutMs: number
  ): Promise<{ data?: TData; errors?: Array<{ message?: string }> }> {
    const operationName = payload.operationName ?? 'anonymous';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        signal: controller.signal,
        body: JSON.stringify({
          operationName: payload.operationName,
          query,
          variables: payload.variables,
        }),
      });

      logTraceEvent(
        'debug',
        'rmp_graphql_response',
        {
          operationName,
          httpStatus: response.status,
          ok: response.ok,
          circuitState: rmpCircuitBreaker.snapshot().state,
        },
        '[RMP] GraphQL response received'
      );

      const raw = await response.text();
      if (!response.ok) {
        throw upstreamErrorFromHttpStatus(
          response.status,
          `RMP API error: ${response.status} ${response.statusText} body=${raw.slice(0, 300)}`
        );
      }

      let parsed: { data?: TData; errors?: Array<{ message?: string }> };
      try {
        parsed = JSON.parse(raw) as {
          data?: TData;
          errors?: Array<{ message?: string }>;
        };
      } catch (parseErr) {
        throw new UpstreamError(
          'UPSTREAM_ERROR',
          `RMP response was not valid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
        );
      }
      if (parsed.errors?.length) {
        getLogger().debug(
          { errors: parsed.errors },
          '[RMP] GraphQL response errors'
        );
        const message = parsed.errors
          .map((err) => err.message || 'unknown RMP error')
          .join('; ');
        throw new UpstreamError(
          'UPSTREAM_ERROR',
          `RMP GraphQL errors: ${message}`
        );
      }

      return parsed;
    } catch (error) {
      getLogger().error({ err: error }, 'RMP Fetch error');
      if (error instanceof UpstreamError) throw error;
      throw upstreamErrorFromUnknown(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
