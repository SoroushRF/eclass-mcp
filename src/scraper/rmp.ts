import {
  UpstreamError,
  upstreamErrorFromHttpStatus,
  upstreamErrorFromUnknown,
} from './scrape-errors';

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

interface GraphQLResponse {
  data?: any;
  errors?: Array<{ message?: string }>;
}

function normalizeQueryText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
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
      console.error(
        `[RMP] searchTeachers done name="${normalizedName}" campus=${campus} direct=0 crossCampus=${probe.length}`
      );
      return { matches, diagnostics };
    }

    console.error(
      `[RMP] searchTeachers done name="${normalizedName}" campus=${campus || 'all'} total=${direct.length}`
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

    console.error(
      `[RMP] searchTeachers start name="${normalizedName}" campus=${campus || 'all'} schools=${schoolIds.length}`
    );

    for (const schoolId of schoolIds) {
      for (const [index, term] of terms.entries()) {
        console.error(
          `[RMP] querying schoolId=${schoolId} term="${term}" attempt=${index + 1}/${terms.length}`
        );

        const data = await this.fetchGraphQL(query, {
          operationName: 'NewSearchTeachersQuery',
          variables: {
            query: { text: term.toLowerCase(), schoolID: schoolId },
            count: 10,
          },
        });
        if (data?.errors?.length) {
          const message = data.errors
            .map((err) => err.message || 'unknown RMP error')
            .join('; ');
          throw new UpstreamError(
            'UPSTREAM_ERROR',
            `RMP GraphQL errors: ${message}`
          );
        }

        const teachers = data?.data?.newSearch?.teachers?.edges || [];
        if (teachers.length === 0) {
          console.error(
            `[RMP] no matches for schoolId=${schoolId} term="${term}"`
          );
          continue;
        }

        for (const t of teachers) {
          const node = t.node as RMPTeacherSearch;
          if (!resultsById.has(node.id)) {
            resultsById.set(node.id, node);
          }
        }

        console.error(
          `[RMP] found ${teachers.length} match(es) for schoolId=${schoolId} term="${term}"`
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

    const data = await this.fetchGraphQL(query, {
      variables: { id: teacherId },
    });
    if (data?.errors?.length) {
      const message = data.errors
        .map((err) => err.message || 'unknown RMP error')
        .join('; ');
      throw new UpstreamError(
        'UPSTREAM_ERROR',
        `RMP GraphQL errors: ${message}`
      );
    }
    const teacher = data?.data?.node;

    if (!teacher || teacher.__typename !== 'Teacher') {
      console.error(
        `[RMP] teacher details missing or wrong type for teacherId=${teacherId}`
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
      ratings: (teacher.ratings?.edges || []).map(
        (e: any) => e.node as RMPRating
      ),
    };
  }

  private async fetchGraphQL(
    query: string,
    payload: { operationName?: string; variables: any }
  ): Promise<GraphQLResponse> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          operationName: payload.operationName,
          query,
          variables: payload.variables,
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        throw upstreamErrorFromHttpStatus(
          response.status,
          `RMP API error: ${response.status} ${response.statusText} body=${raw.slice(0, 300)}`
        );
      }

      let parsed: GraphQLResponse;
      try {
        parsed = JSON.parse(raw) as GraphQLResponse;
      } catch (parseErr) {
        throw new UpstreamError(
          'UPSTREAM_ERROR',
          `RMP response was not valid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
        );
      }
      if (parsed.errors?.length) {
        console.error(
          `[RMP] GraphQL response errors: ${JSON.stringify(parsed.errors)}`
        );
      }

      return parsed;
    } catch (error) {
      console.error('RMP Fetch error:', error);
      if (error instanceof UpstreamError) throw error;
      throw upstreamErrorFromUnknown(error);
    }
  }
}
