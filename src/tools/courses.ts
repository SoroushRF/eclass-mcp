import { getAuthUrl } from '../auth/server';
import { attachCacheMeta } from '../cache/store';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { runEclassToolBoundary, sessionExpiredResponse } from './tool-boundary';
import { getEclassCoursesWithCache } from './eclass-service';
import {
  createDefaultToolDependencies,
  type ToolDependencies,
} from './dependencies';

export async function listCourses(
  deps: ToolDependencies = createDefaultToolDependencies()
) {
  const run = async () => {
    const { courses, cacheMeta } = await getEclassCoursesWithCache(
      deps.eclassScraper
    );
    const payload =
      courses.length === 0
        ? {
            courses,
            status: 'no_data',
            message:
              'No eClass courses were detected. If you are enrolled, re-authenticate and retry.',
            retry: {
              afterAuth: true,
              authUrl: getAuthUrl('eclass'),
            },
          }
        : { courses };

    const resp = attachCacheMeta(payload, cacheMeta);

    return asValidatedMcpText(
      'list_courses',
      EclassToolJsonPayloadSchema,
      resp
    );
  };

  return runEclassToolBoundary({
    toolName: 'list_courses',
    run,
    onSessionExpired: {
      retry: run,
      fallback: (error) =>
        sessionExpiredResponse(
          'list_courses',
          EclassToolJsonPayloadSchema,
          error
        ),
    },
  });
}
