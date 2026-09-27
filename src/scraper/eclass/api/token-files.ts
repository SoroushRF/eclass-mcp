import path from 'path';
import { getLogger } from '../../../logging/context';
import { createSafeApiLogFields } from '../../../logging/api-safe';
import { validateUrlForPolicy } from '../../../security/url-policy';
import { MoodleApiError, classifyHttpStatus } from './errors';
import { readCappedBody, type FetchLike } from './transport';
import { MoodleRestErrorEnvelopeSchema } from './types';

export const WEBSERVICE_PLUGINFILE_PATH = '/webservice/pluginfile.php';
export const DEFAULT_TOKEN_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const DEFAULT_TOKEN_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface TokenDownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: FetchLike;
}

export interface DownloadedFile {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Maps a policy-approved eClass file URL to its web service equivalent,
 * without any token. Returns null for wrapper pages (`/mod/resource/view.php`
 * and similar), which have no token-authenticated form.
 */
export function toWebservicePluginfileUrl(fileUrl: string): string | null {
  const safe = new URL(validateUrlForPolicy(fileUrl, 'eclass_file'));
  const lowerPath = safe.pathname.toLowerCase();
  if (lowerPath.startsWith(WEBSERVICE_PLUGINFILE_PATH)) {
    // Already the web service form.
  } else if (lowerPath.startsWith('/pluginfile.php')) {
    safe.pathname = `/webservice${safe.pathname}`;
  } else {
    return null;
  }
  safe.searchParams.delete('token');
  safe.searchParams.delete('wstoken');
  return validateUrlForPolicy(safe.toString(), 'eclass_file');
}

function filenameFrom(headers: Headers, url: string): string {
  const disposition = headers.get('content-disposition') ?? '';
  const match =
    disposition.match(/filename\*=UTF-8''([^;\n]+)/i) ??
    disposition.match(/filename="?([^";\n]+)"?/i);
  if (match?.[1]) {
    try {
      return path.basename(decodeURIComponent(match[1].trim()));
    } catch {
      return path.basename(match[1].trim());
    }
  }
  try {
    return path.basename(decodeURIComponent(new URL(url).pathname));
  } catch {
    return 'download.bin';
  }
}

function throwForErrorEnvelope(buffer: Buffer): never {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new MoodleApiError({ category: 'malformed_response' });
  }
  const envelope = MoodleRestErrorEnvelopeSchema.safeParse(parsed);
  const code = envelope.success
    ? envelope.data.errorcode?.toLowerCase()
    : undefined;
  if (code === 'invalidtoken') {
    throw new MoodleApiError({
      category: 'mobile_token_invalid',
      upstreamCode: code,
    });
  }
  throw new MoodleApiError({
    category: 'capability_unavailable',
    ...(code ? { upstreamCode: code } : {}),
  });
}

/**
 * Downloads an eClass file with the mobile token via
 * `/webservice/pluginfile.php` (ADR 0011). The URL is policy-checked before
 * the token is appended; only the token-free URL is ever logged or returned.
 */
export async function downloadFileWithToken(
  fileUrl: string,
  token: string,
  options: TokenDownloadOptions = {}
): Promise<DownloadedFile> {
  if (!token.trim()) {
    throw new MoodleApiError({ category: 'mobile_token_invalid' });
  }
  const tokenFreeUrl = toWebservicePluginfileUrl(fileUrl);
  if (!tokenFreeUrl) {
    throw new MoodleApiError({
      category: 'capability_unavailable',
      upstreamCode: 'not_pluginfile',
    });
  }
  const requestUrl = new URL(tokenFreeUrl);
  requestUrl.searchParams.set('token', token);

  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const startedAt = Date.now();
  let status: number | undefined;
  let responseBytes: number | undefined;
  let errorCode: string | undefined;

  try {
    const response = await fetchImpl(requestUrl.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(
        options.timeoutMs ?? DEFAULT_TOKEN_DOWNLOAD_TIMEOUT_MS
      ),
    });
    status = response.status;
    const buffer = await readCappedBody(
      response,
      options.maxBytes ?? DEFAULT_TOKEN_DOWNLOAD_BYTES
    );
    responseBytes = buffer.byteLength;

    if (status < 200 || status >= 300) {
      throw new MoodleApiError({
        category: classifyHttpStatus(status),
        status,
      });
    }

    const mimeType =
      response.headers.get('content-type')?.split(';')[0].trim() ||
      'application/octet-stream';
    if (mimeType === 'application/json') throwForErrorEnvelope(buffer);
    if (mimeType === 'text/html') {
      // A login page, WAF challenge, or wrapper page: not file bytes.
      throw new MoodleApiError({
        category: 'capability_unavailable',
        upstreamCode: 'html_response',
        status,
      });
    }

    return {
      buffer,
      mimeType,
      filename: filenameFrom(response.headers, tokenFreeUrl),
    };
  } catch (error) {
    const normalized =
      error instanceof MoodleApiError
        ? error
        : new MoodleApiError({
            category:
              error instanceof Error &&
              (error.name === 'TimeoutError' || error.name === 'AbortError')
                ? 'timeout'
                : 'upstream',
            status,
          });
    errorCode = normalized.upstreamCode ?? normalized.category;
    throw normalized;
  } finally {
    getLogger().info(
      createSafeApiLogFields({
        operation: 'token_file_download',
        source: 'rest',
        endpointPath: WEBSERVICE_PLUGINFILE_PATH,
        ...(status !== undefined ? { status } : {}),
        durationMs: Date.now() - startedAt,
        ...(responseBytes !== undefined ? { responseBytes } : {}),
        ...(errorCode ? { errorCode } : {}),
      }),
      'Moodle token file download completed'
    );
  }
}
