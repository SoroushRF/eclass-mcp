import pino from 'pino';

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
    redact: {
      paths: ['cookie', 'cookies', 'setCookie', 'headers.cookie'],
      censor: '[Redacted]',
    },
  },
  pino.destination({ fd: 2 })
);

export function createChildForTool(
  tool: string,
  requestId: string
): pino.Logger {
  return rootLogger.child({ tool, requestId });
}
