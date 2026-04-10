import { CengageScraper } from '../scraper/cengage';
import {
  CengageAuthRequiredError,
  CengageError,
} from '../scraper/cengage-errors';
import type { GetCengageAssignmentsResponse } from './cengage-contracts';
import { GetCengageAssignmentsResponseSchema } from './cengage-contracts';

function normalizeAssignmentStatus(
  rawStatus: string
): 'pending' | 'submitted' | 'graded' | 'unknown' {
  const normalized = rawStatus.toLowerCase();
  if (normalized.includes('submitted')) return 'submitted';
  if (normalized.includes('graded')) return 'graded';
  if (normalized.includes('pending')) return 'pending';
  return 'unknown';
}

function asToolResponse(payload: GetCengageAssignmentsResponse) {
  const validated = GetCengageAssignmentsResponseSchema.parse(payload);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(validated) }],
  };
}

export async function getCengageAssignments(ssoUrl: string) {
  const scraper = new CengageScraper();
  try {
    const assignments = await scraper.getAssignments(ssoUrl);

    const assignmentRows = assignments.map((a) => ({
      name: a.name,
      dueDate: a.dueDate,
      status: normalizeAssignmentStatus(a.status),
      score: a.score,
      assignmentId: a.id,
    }));

    if (assignments.length === 0) {
      return asToolResponse({
        status: 'no_data',
        entryUrl: ssoUrl,
        assignments: assignmentRows,
        message:
          'No assignments were found. Verify the URL points to the correct course/dashboard and that your Cengage session is active.',
      });
    }

    return asToolResponse({
      status: 'ok',
      entryUrl: ssoUrl,
      assignments: assignmentRows,
    });
  } catch (error: unknown) {
    if (error instanceof CengageAuthRequiredError) {
      return asToolResponse({
        status: 'auth_required',
        entryUrl: ssoUrl,
        assignments: [],
        message:
          'Cengage authentication required. Please log in at http://localhost:3000/auth-cengage and retry.',
      });
    }

    if (error instanceof CengageError) {
      return asToolResponse({
        status: 'error',
        entryUrl: ssoUrl,
        assignments: [],
        message: `${error.message} [${error.code}]`,
      });
    }

    if (error instanceof Error) {
      return asToolResponse({
        status: 'error',
        entryUrl: ssoUrl,
        assignments: [],
        message: `Failed to fetch Cengage assignments: ${error.message}`,
      });
    }

    return asToolResponse({
      status: 'error',
      entryUrl: ssoUrl,
      assignments: [],
      message: 'Failed to fetch Cengage assignments due to an unknown error.',
    });
  } finally {
    await scraper.close();
  }
}
