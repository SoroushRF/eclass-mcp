import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { RMPClient } from "../scraper/rmp.js";
import { cache } from "../cache/store.js";

const rmpClient = new RMPClient();
const CACHE_TTL = 7 * 24 * 60; // 7 days in minutes

/**
 * Tool to search for professor profiles on RMP
 */
export async function searchProfessorsTool(args: any) {
    const { name, campus } = args;
    
    if (!name) {
        throw new McpError(ErrorCode.InvalidParams, "Professor name is required");
    }

    try {
        const cacheKey = `rmp_search_${name}_${campus || 'all'}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const results = await rmpClient.searchTeachers(name, campus);
        
        const response = {
            matches: results.map(t => ({
                teacherId: t.id,
                legacyId: t.legacyId,
                name: `${t.firstName} ${t.lastName}`,
                department: t.department,
                school: t.school.name
            }))
        };

        cache.set(cacheKey, response, CACHE_TTL);
        return response;
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
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const details = await rmpClient.getTeacherDetails(teacherId);
        if (!details) {
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
        return response;
    } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, `Failed to fetch RMP details: ${error.message}`);
    }
}
