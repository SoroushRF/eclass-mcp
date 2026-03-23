import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { RMPClient, type RMPTeacherSearch } from "../scraper/rmp.js";
import { cache } from "../cache/store.js";

const rmpClient = new RMPClient();
const CACHE_TTL = 7 * 24 * 60; // 7 days in minutes

function normalizeSearchName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildSearchSummary(response: {
    matches: Array<{
        teacherId: string;
        legacyId: number;
        name: string;
        department: string;
        school: string;
    }>;
    diagnostics: any;
}): string {
    const lines: string[] = [];

    if (response.matches.length === 0) {
        lines.push('No RMP matches found.');
    } else {
        lines.push(`Found ${response.matches.length} RMP match(es):`);
        for (const match of response.matches) {
            lines.push(
                `- ${match.name} | ${match.department} | ${match.school} | teacherId=${match.teacherId}`
            );
        }
    }

    if (response.diagnostics) {
        lines.push('');
        lines.push(`Diagnostics: normalizedName="${response.diagnostics.normalizedName}"`);
        if (response.diagnostics.campus) {
            lines.push(`Campus filter: ${response.diagnostics.campus}`);
        }
        lines.push(
            `Direct matches: ${response.diagnostics.directMatchCount}, cross-campus probe: ${response.diagnostics.crossCampusMatchCount}`
        );
        if (response.diagnostics.note) {
            lines.push(`Note: ${response.diagnostics.note}`);
        }
    }

    return lines.join('\n');
}

function toSearchToolResult(response: {
    matches: Array<{
        teacherId: string;
        legacyId: number;
        name: string;
        department: string;
        school: string;
    }>;
    diagnostics: any;
}) {
    return {
        content: [{ type: 'text' as const, text: buildSearchSummary(response) }],
        matches: response.matches,
        diagnostics: response.diagnostics,
    };
}

function buildDetailsSummary(response: {
    professor: {
        name: string;
        department: string;
        school: string;
        metrics: {
            overallRating: number;
            difficulty: number;
            numRatings: number;
            wouldTakeAgainPercent: number;
        };
    };
    recentReviews: Array<{
        rating: number;
        difficulty: number;
        course: string;
        date: string;
        grade: string;
        comment: string;
        wouldTakeAgain: string;
    }>;
}): string {
    const { professor, recentReviews } = response;
    const lines = [
        `${professor.name} | ${professor.department} | ${professor.school}`,
        `Overall rating: ${professor.metrics.overallRating}, difficulty: ${professor.metrics.difficulty}, ratings: ${professor.metrics.numRatings}, would-take-again: ${professor.metrics.wouldTakeAgainPercent}%`,
    ];

    if (recentReviews.length === 0) {
        lines.push('No recent reviews returned.');
    } else {
        lines.push(`Recent reviews: ${recentReviews.length}`);
        for (const review of recentReviews.slice(0, 5)) {
            lines.push(
                `- ${review.course} | ${review.date} | clarity=${review.rating} | difficulty=${review.difficulty} | wouldTakeAgain=${review.wouldTakeAgain}`
            );
            if (review.comment) {
                lines.push(`  "${review.comment}"`);
            }
        }
    }

    return lines.join('\n');
}

function toDetailsToolResult(response: {
    professor: {
        name: string;
        department: string;
        school: string;
        metrics: {
            overallRating: number;
            difficulty: number;
            numRatings: number;
            wouldTakeAgainPercent: number;
        };
    };
    recentReviews: Array<{
        rating: number;
        difficulty: number;
        course: string;
        date: string;
        grade: string;
        comment: string;
        wouldTakeAgain: string;
    }>;
}) {
    return {
        content: [{ type: 'text' as const, text: buildDetailsSummary(response) }],
        ...response,
    };
}

/**
 * Tool to search for professor profiles on RMP
 */
export async function searchProfessorsTool(args: any) {
    const { name, campus } = args;
    
    if (!name) {
        throw new McpError(ErrorCode.InvalidParams, "Professor name is required");
    }

    try {
        const normalizedName = normalizeSearchName(name);
        const cacheKey = `rmp_search_${normalizedName}_${campus || 'all'}`;
        const cached = cache.get<any>(cacheKey);
        if (cached) {
            console.error(`[RMP] search cache hit for "${normalizedName}" (${campus || 'all'})`);
            return toSearchToolResult(cached);
        }

        console.error(`[RMP] search cache miss for "${normalizedName}" (${campus || 'all'})`);

        const report = await rmpClient.searchTeachersWithDiagnostics(name, campus);

        const response = {
            matches: report.matches.map((t: RMPTeacherSearch) => ({
                teacherId: t.id,
                legacyId: t.legacyId,
                name: `${t.firstName} ${t.lastName}`,
                department: t.department,
                school: t.school.name
            })),
            diagnostics: report.diagnostics
        };

        if (response.matches.length > 0 && !report.diagnostics.usedCrossCampusProbe) {
            cache.set(cacheKey, response, CACHE_TTL);
            console.error(`[RMP] cached ${response.matches.length} match(es) for "${normalizedName}" (${campus || 'all'})`);
        } else {
            console.error(
                `[RMP] not caching result for "${normalizedName}" (${campus || 'all'})` +
                    (report.diagnostics.usedCrossCampusProbe ? ' because it came from a fallback probe' : ' because it was empty')
            );
        }
        return toSearchToolResult(response);
    } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to search RMP: ${error.message}`);
    }
}

/**
 * Tool to get detailed ratings for a professor
 */
export async function getProfessorDetailsTool(args: any) {
    const { teacherId } = args;

    if (!teacherId) {
        throw new McpError(ErrorCode.InvalidParams, "teacherId is required");
    }

    try {
        const cacheKey = `rmp_details_${teacherId}`;
        const cached = cache.get<any>(cacheKey);
        if (cached) {
            console.error(`[RMP] detail cache hit for teacherId=${teacherId}`);
            return toDetailsToolResult(cached);
        }

        console.error(`[RMP] detail cache miss for teacherId=${teacherId}`);

        const details = await rmpClient.getTeacherDetails(teacherId);
        if (!details) {
            console.error(`[RMP] no details returned for teacherId=${teacherId}`);
            return { error: "Professor not found or profile is unavailable." };
        }

        const response = {
            professor: {
                name: `${details.firstName} ${details.lastName}`,
                department: details.department,
                school: details.school.name,
                metrics: {
                    overallRating: details.avgRating,
                    difficulty: details.avgDifficulty,
                    numRatings: details.numRatings,
                    wouldTakeAgainPercent: details.wouldTakeAgainPercent
                }
            },
            recentReviews: details.ratings.map(r => ({
                rating: r.clarityRating, // Or average of clarity/helpful
                difficulty: r.difficultyRating,
                course: r.class,
                date: r.date,
                grade: r.grade,
                comment: r.comment,
                wouldTakeAgain: r.wouldTakeAgain === 1 ? "Yes" : r.wouldTakeAgain === 0 ? "No" : "N/A"
            }))
        };

        cache.set(cacheKey, response, CACHE_TTL);
        console.error(`[RMP] cached details for teacherId=${teacherId}`);
        return toDetailsToolResult(response);
    } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to fetch RMP details: ${error.message}`);
    }
}
