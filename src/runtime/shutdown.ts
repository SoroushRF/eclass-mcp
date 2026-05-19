export type ShutdownCloser = {
  name: string;
  close: () => void | Promise<void>;
};

export type ShutdownLogger = {
  info?: (obj: Record<string, unknown>, msg: string) => void;
  warn?: (obj: Record<string, unknown>, msg: string) => void;
};

export type SignalTarget = {
  once: (signal: NodeJS.Signals, listener: () => void) => unknown;
  off: (signal: NodeJS.Signals, listener: () => void) => unknown;
};

export type OnCloseTarget = {
  onclose?: () => void;
};

export type ShutdownController = {
  shutdown: (reason?: string) => Promise<void>;
  bindOnClose: (target: OnCloseTarget, reason?: string) => () => void;
  installSignalHandlers: (
    signals?: NodeJS.Signals[],
    target?: SignalTarget
  ) => () => void;
};

export type ShutdownControllerOptions = {
  closers: ShutdownCloser[];
  logger?: ShutdownLogger;
  exit?: (code: number) => void;
  signalShutdownTimeoutMs?: number;
};

const DEFAULT_SIGNAL_SHUTDOWN_TIMEOUT_MS = 5000;

function errorForLog(error: unknown): Error | { message: string } {
  return error instanceof Error ? error : { message: String(error) };
}

function wait(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('timeout'), ms);
    timeout.unref?.();
  });
}

export function createShutdownController(
  options: ShutdownControllerOptions
): ShutdownController {
  let shutdownPromise: Promise<void> | null = null;
  const signalShutdownTimeoutMs =
    options.signalShutdownTimeoutMs ?? DEFAULT_SIGNAL_SHUTDOWN_TIMEOUT_MS;

  async function runShutdown(reason: string): Promise<void> {
    options.logger?.info?.(
      { component: 'shutdown', event: 'shutdown_start', reason },
      'Shutting down runtime resources'
    );

    const results = await Promise.allSettled(
      options.closers.map(async (closer) => {
        options.logger?.info?.(
          {
            component: 'shutdown',
            event: 'shutdown_resource_close_start',
            resource: closer.name,
            reason,
          },
          'Closing shutdown resource'
        );
        await closer.close();
        options.logger?.info?.(
          {
            component: 'shutdown',
            event: 'shutdown_resource_close_end',
            resource: closer.name,
            reason,
          },
          'Closed shutdown resource'
        );
      })
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        continue;
      }

      options.logger?.warn?.(
        {
          component: 'shutdown',
          event: 'shutdown_resource_close_error',
          err: errorForLog(result.reason),
          resource: options.closers[i]?.name ?? 'unknown',
          reason,
        },
        'Shutdown resource cleanup failed'
      );
    }
  }

  function shutdown(reason: string = 'manual'): Promise<void> {
    if (!shutdownPromise) {
      shutdownPromise = runShutdown(reason);
    }
    return shutdownPromise;
  }

  function bindOnClose(
    target: OnCloseTarget,
    reason: string = 'transport_close'
  ): () => void {
    const previous = target.onclose;
    target.onclose = () => {
      try {
        previous?.();
      } finally {
        void shutdown(reason);
      }
    };

    return () => {
      target.onclose = previous;
    };
  }

  function installSignalHandlers(
    signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'],
    target: SignalTarget = process
  ): () => void {
    const listeners = signals.map((signal) => {
      const listener = () => {
        void (async () => {
          const shutdownTask = shutdown(signal);
          const result = await Promise.race([
            shutdownTask.then(() => 'shutdown' as const),
            wait(signalShutdownTimeoutMs),
          ]);

          if (result === 'timeout') {
            options.logger?.warn?.(
              {
                component: 'shutdown',
                event: 'shutdown_timeout',
                signal,
                timeoutMs: signalShutdownTimeoutMs,
              },
              'Shutdown timed out before process exit'
            );
          }

          options.exit?.(0);
        })();
      };

      target.once(signal, listener);
      return { signal, listener };
    });

    return () => {
      for (const { signal, listener } of listeners) {
        target.off(signal, listener);
      }
    };
  }

  return {
    shutdown,
    bindOnClose,
    installSignalHandlers,
  };
}
