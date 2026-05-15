import { SessionExpiredError } from '../scraper/eclass';
import { getAuthUrl } from '../auth/server';
import { attachCacheMeta } from '../cache/store';
import { sessionExpiredPayload } from '../errors/tool-error';
import { EclassToolJsonPayloadSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import {
  handleEclassSessionExpired,
  isSessionStorageUnavailable,
  sessionStorageUnavailableResponse,
} from './auth-retry';
import { getEclassCoursesWithCache } from './eclass-service';
import {
  isScrapeLayoutChanged,
  scrapeLayoutChangedResponse,
} from './scrape-layout-response';

export async function listCourses() {
  const run = async () => {
    const { courses, cacheMeta } = await getEclassCoursesWithCache();
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

  try {
    return await run();
  } catch (e) {
    if (isSessionStorageUnavailable(e)) {
      return sessionStorageUnavailableResponse('list_courses');
    }
    if (isScrapeLayoutChanged(e)) {
      return scrapeLayoutChangedResponse('list_courses', e);
    }
    if (e instanceof SessionExpiredError) {
      return handleEclassSessionExpired(e, run, (error) =>
        asValidatedMcpText(
          'list_courses',
          EclassToolJsonPayloadSchema,
          sessionExpiredPayload(error.message, {
            afterAuth: true,
            authUrl: getAuthUrl('eclass'),
          })
        )
      );
    }
    throw e;
  }
}
