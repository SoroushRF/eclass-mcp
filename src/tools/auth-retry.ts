import * as authServer from '../auth/server';
import { SessionExpiredError } from '../scraper/session';

export async function handleEclassSessionExpired<T>(
  error: SessionExpiredError,
  retryOperation: () => Promise<T>,
  fallback: (error: SessionExpiredError) => T | Promise<T>
): Promise<T> {
  authServer.openAuthWindow('eclass');

  const authenticated = await authServer.waitForAuthSession();
  if (!authenticated) {
    return fallback(error);
  }

  try {
    return await retryOperation();
  } catch (retryError) {
    if (retryError instanceof SessionExpiredError) {
      return fallback(retryError);
    }
    throw retryError;
  }
}
