import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import { createChildForTool, rootLogger } from './logger';

export interface ToolLogContext {
  requestId: string;
  tool: string;
  log: Logger;
}

const toolContext = new AsyncLocalStorage<ToolLogContext>();

/**
 * Logger for the current async chain, or the root logger if outside a tool invocation.
 */
export function getLogger(): Logger {
  return toolContext.getStore()?.log ?? rootLogger;
}

/**
 * Run `fn` inside AsyncLocalStorage with a child logger (`tool`, `requestId`) and log start/end/error.
 */
export async function runWithToolContext<T>(
  tool: string,
  fn: () => Promise<T>
): Promise<T> {
  const requestId = randomUUID();
  const log = createChildForTool(tool, requestId);
  const store: ToolLogContext = { requestId, tool, log };

  return toolContext.run(store, async () => {
    log.info({ event: 'tool_start' });
    const t0 = Date.now();
    try {
      const result = await fn();
      log.info({ event: 'tool_end', durationMs: Date.now() - t0 });
      return result;
    } catch (err) {
      log.error({
        err,
        event: 'tool_error',
        durationMs: Date.now() - t0,
      });
      throw err;
    }
  });
}
