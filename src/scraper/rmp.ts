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

export const YORK_SCHOOL_IDS = {
    KEELE: "U2Nob29sLTEyMjQ=",
    GLENDON: "U2Nob29sLTEyMTI1",
    MARKHAM: "U2Nob29sLTE5Mzcy"
};

export class RMPClient {
    private endpoint = "https://www.ratemyprofessors.com/graphql";
    private auth = "Basic dGVzdDp0ZXN0";
    private headers = {
        "Authorization": this.auth,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://www.ratemyprofessors.com/"
    };

    /**
     * Search for teachers by name across all or specific York campuses
     */
    async searchTeachers(name: string, campus?: "Keele" | "Glendon" | "Markham"): Promise<RMPTeacherSearch[]> {
        const query = `
        query TeacherSearchPaginationQuery($query: TeacherSearchQuery!) {
          newSearch {
            teachers(query: $query, first: 20) {
              edges {
                node {
                  id
                  legacyId
                  firstName
                  lastName
                  department
                  school {
                    name
                    id
                  }
                }
              }
            }
          }
        }
        `;

        const results: RMPTeacherSearch[] = [];
        
        let targetSchoolIds: string[] = [];
        if (campus) {
            const key = campus.toUpperCase() as keyof typeof YORK_SCHOOL_IDS;
            targetSchoolIds = [YORK_SCHOOL_IDS[key]];
        } else {
            targetSchoolIds = Object.values(YORK_SCHOOL_IDS);
        }

        const schoolPromises = targetSchoolIds.map(schoolId => 
            this.fetchGraphQL(query, { query: { text: name, schoolID: schoolId } })
        );

        const responses = await Promise.all(schoolPromises);
        
        for (const data of responses) {
            const teachers = data?.data?.newSearch?.teachers?.edges || [];
            teachers.forEach((t: any) => {
                results.push(t.node as RMPTeacherSearch);
            });
        }

        return results;
    }

    /**
     * Get detailed ratings and comments for a teacher
     */
    async getTeacherDetails(teacherId: string): Promise<RMPTeacherDetails | null> {
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
                  }
                }
              }
            }
          }
        }
        `;

        const data = await this.fetchGraphQL(query, { id: teacherId });
        const teacher = data?.data?.node;

        if (!teacher || teacher.__typename !== "Teacher") {
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
            ratings: (teacher.ratings?.edges || []).map((e: any) => e.node as RMPRating)
        };
    }

    private async fetchGraphQL(query: string, variables: any): Promise<any> {
        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({ query, variables })
            });

            if (!response.ok) {
                throw new Error(`RMP API error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('RMP Fetch error:', error);
            return null;
        }
    }
}
