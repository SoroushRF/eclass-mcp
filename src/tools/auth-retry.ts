import * as authServer from '../auth/server';
import { sessionStorageUnavailablePayload } from '../errors/tool-error';
import { SessionExpiredError } from '../scraper/session';
import { SecureSessionStorageError } from '../security/secure-session-store';
import { EclassToolErrorResponseSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';

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

export function isSessionStorageUnavailable(
  error: unknown
): error is SecureSessionStorageError {
  return error instanceof SecureSessionStorageError;
}

export function sessionStorageUnavailableResponse(toolName: string) {
  return asValidatedMcpText(
    toolName,
    EclassToolErrorResponseSchema,
    sessionStorageUnavailablePayload(
      'Secure session storage is unavailable. Set ECLASS_MCP_SESSION_SECRET, clear old plaintext sessions, then authenticate again.'
    )
  );
}
