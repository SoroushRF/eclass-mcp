import { getAuthUrl } from '../auth/server';
import { sessionExpiredPayload, toErrorPayload } from '../errors/tool-error';
import { ValidationError } from '../errors/validation-error';
import {
  ScrapeLayoutError,
  SessionExpiredError,
  UpstreamError,
} from '../scraper/eclass';
import { SecureSessionStorageError } from '../security/secure-session-store';
import { handleEclassSessionExpired } from './auth-retry';
import { EclassToolErrorResponseSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';
import { sessionStorageUnavailableResponse } from './auth-retry';
import type { z } from 'zod';
import { logTraceEvent, runWithSpan } from '../logging/context';

type AuthPlatform = 'eclass' | 'cengage';

export type McpTextResponse = {
  content: [{ type: 'text'; text: string }];
};

export type McpToolResult = {
  content: unknown[];
  isError?: boolean;
};

export type ToolBoundaryOptions<T extends McpToolResult> = {
  toolName: string;
  run: () => Promise<T>;
  onSessionExpired?: {
    attempted?: boolean;
    retry: () => Promise<T>;
    fallback: (error: SessionExpiredError) => T | Promise<T>;
  };
  onValidationError?: (error: ValidationError) => T | Promise<T>;
  onScrapeLayoutError?: (error: ScrapeLayoutError) => T | Promise<T>;
  onUpstreamError?: (error: UpstreamError) => T | Promise<T>;
  onUnknownError?: (error: unknown) => T | Promise<T>;
};

function toBoundaryResult<T extends McpToolResult>(
  response: McpTextResponse
): T {
  return response as unknown as T;
}

export function validationFailedResponse(
  toolName: string,
  error: ValidationError
): McpTextResponse {
  return asValidatedMcpText(
    toolName,
    EclassToolErrorResponseSchema,
    toErrorPayload('VALIDATION_FAILED', error.message, {
      ...(error.details ? { details: error.details } : {}),
    })
  );
}

export function scrapeLayoutChangedResponse(
  toolName: string,
  error: ScrapeLayoutError
): McpTextResponse {
  return asValidatedMcpText(
    toolName,
    EclassToolErrorResponseSchema,
    toErrorPayload('SCRAPE_LAYOUT_CHANGED', error.message, {
      details: error.context,
    })
  );
}

export function upstreamErrorResponse(
  toolName: string,
  error: UpstreamError
): McpTextResponse {
  return asValidatedMcpText(
    toolName,
    EclassToolErrorResponseSchema,
    toErrorPayload(error.code, error.message, {
      ...(error.httpStatus !== undefined
        ? { details: { httpStatus: error.httpStatus } }
        : {}),
    })
  );
}

export function sessionExpiredResponse(
  toolName: string,
  schema: z.ZodType<unknown>,
  error: SessionExpiredError,
  platform: AuthPlatform = 'eclass'
): McpTextResponse {
  return asValidatedMcpText(
    toolName,
    schema,
    sessionExpiredPayload(error.message, {
      afterAuth: true,
      authUrl: getAuthUrl(platform),
    })
  );
}

export async function runEclassToolBoundary<T extends McpToolResult>(
  options: ToolBoundaryOptions<T>
): Promise<T> {
  return runWithSpan(
    'tool.boundary',
    () => runEclassToolBoundaryInner(options),
    {
      component: 'tool-boundary',
      fields: { toolName: options.toolName },
    }
  );
}

async function runEclassToolBoundaryInner<T extends McpToolResult>(
  options: ToolBoundaryOptions<T>
): Promise<T> {
  try {
    return await options.run();
  } catch (error) {
    if (error instanceof SecureSessionStorageError) {
      logTraceEvent(
        'warn',
        'tool_boundary_error_mapped',
        { toolName: options.toolName, code: error.code },
        'Tool boundary mapped error'
      );
      return toBoundaryResult<T>(
        sessionStorageUnavailableResponse(options.toolName)
      );
    }

    if (error instanceof SessionExpiredError && options.onSessionExpired) {
      logTraceEvent(
        'warn',
        'tool_boundary_error_mapped',
        { toolName: options.toolName, code: error.code },
        'Tool boundary mapped error'
      );
      const { attempted, retry, fallback } = options.onSessionExpired;
      if (attempted) {
        return fallback(error);
      }
      return handleEclassSessionExpired(error, retry, fallback);
    }

    if (error instanceof ValidationError) {
      logTraceEvent(
        'warn',
        'tool_boundary_error_mapped',
        { toolName: options.toolName, code: error.code },
        'Tool boundary mapped error'
      );
      if (options.onValidationError) {
        return options.onValidationError(error);
      }
      return toBoundaryResult<T>(
        validationFailedResponse(options.toolName, error)
      );
    }

    if (error instanceof ScrapeLayoutError) {
      logTraceEvent(
        'warn',
        'tool_boundary_error_mapped',
        { toolName: options.toolName, code: error.code },
        'Tool boundary mapped error'
      );
      if (options.onScrapeLayoutError) {
        return options.onScrapeLayoutError(error);
      }
      return toBoundaryResult<T>(
        scrapeLayoutChangedResponse(options.toolName, error)
      );
    }

    if (error instanceof UpstreamError) {
      logTraceEvent(
        'warn',
        'tool_boundary_error_mapped',
        { toolName: options.toolName, code: error.code },
        'Tool boundary mapped error'
      );
      if (options.onUpstreamError) {
        return options.onUpstreamError(error);
      }
      return toBoundaryResult<T>(
        upstreamErrorResponse(options.toolName, error)
      );
    }

    if (options.onUnknownError) {
      logTraceEvent(
        'error',
        'tool_boundary_unknown_error_mapped',
        { toolName: options.toolName },
        'Tool boundary mapped unknown error'
      );
      return options.onUnknownError(error);
    }

    logTraceEvent(
      'error',
      'tool_boundary_unknown_error',
      { toolName: options.toolName },
      'Tool boundary rethrowing unknown error'
    );
    throw error;
  }
}
