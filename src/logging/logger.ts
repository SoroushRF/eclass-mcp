import pino from 'pino';
import { serializeErrorForLog } from './api-safe';

const ALLOWED_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const;

function parseLogLevel(v: string | undefined): (typeof ALLOWED_LEVELS)[number] {
  if (!v) return 'info';
  const x = v.toLowerCase().trim();
  return (ALLOWED_LEVELS as readonly string[]).includes(x)
    ? (x as (typeof ALLOWED_LEVELS)[number])
    : 'info';
}

/**
 * Root logger: JSON to **stderr** only so MCP stdio transport keeps stdout for JSON-RPC.
 */
export const rootLogger: pino.Logger = pino(
  {
    level: parseLogLevel(process.env.ECLASS_MCP_LOG_LEVEL),
    serializers: {
      err: serializeErrorForLog,
    },
    redact: {
      paths: [
        'cookie',
        'cookies',
        'setCookie',
        'set-cookie',
        'headers.cookie',
        'headers.Cookie',
        'headers.authorization',
        'headers.Authorization',
        'headers.location',
        'headers.Location',
        'headers.set-cookie',
        'headers["set-cookie"]',
        'authorization',
        'Authorization',
        'location',
        'Location',
        'sesskey',
        'wstoken',
        'token',
        'passport',
        'request.body',
        'requestBody',
        'response.body',
        'responseBody',
        'body.sesskey',
        'body.wstoken',
        'body.token',
        'body.passport',
      ],
      censor: '[Redacted]',
    },
  },
  pino.destination({ fd: 2 })
);

export interface ToolLoggerBindings {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  span?: string;
  component?: string;
}

export function createChildForTool(
  tool: string,
  requestId: string,
  bindings: ToolLoggerBindings = {}
): pino.Logger {
  return rootLogger.child({ tool, requestId, ...bindings });
}
