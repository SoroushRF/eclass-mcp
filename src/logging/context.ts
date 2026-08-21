import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { createChildForTool, rootLogger } from './logger';
import { serializeErrorForLog } from './api-safe';
import { redactStructuredLogFields } from './redact';

export interface ToolLogContext {
  requestId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  tool: string;
  span: string;
  component?: string;
  log: Logger;
}

const toolContext = new AsyncLocalStorage<ToolLogContext>();

export type TraceContext = Omit<ToolLogContext, 'log'>;

export interface SpanOptions {
  component?: string;
  fields?: Record<string, unknown>;
}

type TraceLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger for the current async chain, or the root logger if outside a tool invocation.
 */
export function getLogger(): Logger {
  return toolContext.getStore()?.log ?? rootLogger;
}

export function getTraceContext(): TraceContext | null {
  const store = toolContext.getStore();
  if (!store) return null;
  const { log: _log, ...context } = store;
  return context;
}

/**
 * Run `fn` inside AsyncLocalStorage with a child logger (`tool`, `requestId`) and log start/end/error.
 */
export async function runWithToolContext<T>(
  tool: string,
  fn: () => Promise<T>
): Promise<T> {
  const requestId = randomUUID();
  const traceId = requestId;
  const spanId = randomUUID();
  const span = 'mcp.tool';
  const component = 'mcp';
  const log = createChildForTool(tool, requestId, {
    traceId,
    spanId,
    span,
    component,
  });
  const store: ToolLogContext = {
    requestId,
    traceId,
    spanId,
    tool,
    span,
    component,
    log,
  };

  return toolContext.run(store, async () => {
    log.info({ event: 'tool_start' });
    const t0 = Date.now();
    try {
      const result = await fn();
      log.info({ event: 'tool_end', durationMs: Date.now() - t0 });
      return result;
    } catch (err) {
      log.error({
        err: serializeErrorForLog(err),
        event: 'tool_error',
        durationMs: Date.now() - t0,
      });
      throw err;
    }
  });
}

export async function runWithSpan<T>(
  span: string,
  fn: () => Promise<T>,
  options: SpanOptions = {}
): Promise<T> {
  const parent = toolContext.getStore();
  const requestId = parent?.requestId ?? randomUUID();
  const traceId = parent?.traceId ?? requestId;
  const spanId = randomUUID();
  const parentSpanId = parent?.spanId;
  const tool = parent?.tool ?? 'runtime';
  const component = options.component ?? parent?.component;
  const bindings = {
    tool,
    requestId,
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    span,
    ...(component ? { component } : {}),
  };
  const log = rootLogger.child(bindings);
  const store: ToolLogContext = {
    requestId,
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    tool,
    span,
    ...(component ? { component } : {}),
    log,
  };

  return toolContext.run(store, async () => {
    log.info({
      event: 'span_start',
      ...redactStructuredLogFields(options.fields ?? {}),
    });
    const t0 = Date.now();
    try {
      const result = await fn();
      log.info({
        event: 'span_end',
        durationMs: Date.now() - t0,
        ...redactStructuredLogFields(options.fields ?? {}),
      });
      return result;
    } catch (err) {
      log.error({
        err: serializeErrorForLog(err),
        event: 'span_error',
        durationMs: Date.now() - t0,
        ...redactStructuredLogFields(options.fields ?? {}),
      });
      throw err;
    }
  });
}

export function logTraceEvent(
  level: TraceLogLevel,
  event: string,
  fields: Record<string, unknown> = {},
  message: string = event
): void {
  const log = getLogger();
  const payload = {
    event,
    ...redactStructuredLogFields(fields),
  };
  switch (level) {
    case 'trace':
      log.trace(payload, message);
      break;
    case 'debug':
      log.debug(payload, message);
      break;
    case 'info':
      log.info(payload, message);
      break;
    case 'warn':
      log.warn(payload, message);
      break;
    case 'error':
      log.error(payload, message);
      break;
  }
}
