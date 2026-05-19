import { describe, expect, it, vi } from 'vitest';
import {
  createShutdownController,
  type SignalTarget,
} from '../src/runtime/shutdown';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('shutdown controller', () => {
  it('closes all registered resources exactly once', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const controller = createShutdownController({
      closers: [
        { name: 'first', close: first },
        { name: 'second', close: second },
      ],
    });

    await controller.shutdown('manual');
    await controller.shutdown('manual_again');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('logs failed closers without skipping later cleanup', async () => {
    const failed = new Error('close failed');
    const first = vi.fn(async () => {
      throw failed;
    });
    const second = vi.fn(async () => undefined);
    const warn = vi.fn();
    const controller = createShutdownController({
      logger: { warn },
      closers: [
        { name: 'first', close: first },
        { name: 'second', close: second },
      ],
    });

    await expect(controller.shutdown('test')).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failed,
        resource: 'first',
        reason: 'test',
      }),
      'Shutdown resource cleanup failed'
    );
  });

  it('routes transport close callbacks into shutdown and preserves existing handler', async () => {
    const previous = vi.fn();
    const close = vi.fn(async () => undefined);
    const target = { onclose: previous };
    const controller = createShutdownController({
      closers: [{ name: 'transport', close }],
    });

    const restore = controller.bindOnClose(target);
    target.onclose?.();
    await flushMicrotasks();

    expect(previous).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    restore();
    expect(target.onclose).toBe(previous);
  });

  it('routes signal handlers into shutdown and calls the configured exit hook', async () => {
    const close = vi.fn(async () => undefined);
    const exit = vi.fn();
    const listeners = new Map<NodeJS.Signals, () => void>();
    const signalTarget: SignalTarget = {
      once: vi.fn((signal, listener) => {
        listeners.set(signal, listener);
      }),
      off: vi.fn((signal) => {
        listeners.delete(signal);
      }),
    };
    const controller = createShutdownController({
      exit,
      closers: [{ name: 'resource', close }],
    });

    const uninstall = controller.installSignalHandlers(
      ['SIGINT'],
      signalTarget
    );
    listeners.get('SIGINT')?.();
    await flushMicrotasks();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    uninstall();
    expect(signalTarget.off).toHaveBeenCalledWith(
      'SIGINT',
      expect.any(Function)
    );
  });
});
