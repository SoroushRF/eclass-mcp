import { describe, expect, it, vi } from 'vitest';
import {
  CircuitBreaker,
  type CircuitBreakerEvent,
  CircuitBreakerOpenError,
} from '../src/runtime/circuit-breaker';

function makeBreaker(
  nowRef: { value: number },
  failureThreshold = 3,
  events?: CircuitBreakerEvent[]
) {
  return new CircuitBreaker({
    name: 'test-service',
    failureThreshold,
    cooldownMs: 1_000,
    now: () => nowRef.value,
    ...(events ? { onEvent: (event) => events.push(event) } : {}),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CircuitBreaker', () => {
  it('allows successful calls and keeps the breaker closed', async () => {
    const nowRef = { value: 1_000 };
    const breaker = makeBreaker(nowRef);

    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');

    expect(breaker.snapshot()).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
    });
  });

  it('opens after the configured consecutive failure threshold', async () => {
    const nowRef = { value: 1_000 };
    const breaker = makeBreaker(nowRef, 3);
    const failingOperation = async () => {
      throw new Error('upstream failed');
    };

    await expect(breaker.execute(failingOperation)).rejects.toThrow(
      'upstream failed'
    );
    await expect(breaker.execute(failingOperation)).rejects.toThrow(
      'upstream failed'
    );
    await expect(breaker.execute(failingOperation)).rejects.toThrow(
      'upstream failed'
    );

    expect(breaker.snapshot()).toMatchObject({
      state: 'open',
      consecutiveFailures: 3,
      openedAtMs: 1_000,
    });
  });

  it('fails fast while open without invoking the operation', async () => {
    const nowRef = { value: 1_000 };
    const breaker = makeBreaker(nowRef, 1);

    await expect(
      breaker.execute(async () => {
        throw new Error('first failure');
      })
    ).rejects.toThrow('first failure');

    const operation = vi.fn(async () => 'should not run');
    await expect(breaker.execute(operation)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('allows one half-open probe after cooldown and closes on success', async () => {
    const nowRef = { value: 1_000 };
    const breaker = makeBreaker(nowRef, 1);

    await expect(
      breaker.execute(async () => {
        throw new Error('first failure');
      })
    ).rejects.toThrow('first failure');

    nowRef.value += 1_001;
    await expect(breaker.execute(async () => 'recovered')).resolves.toBe(
      'recovered'
    );

    expect(breaker.snapshot()).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
      openedAtMs: null,
    });
  });

  it('reopens when the half-open probe fails', async () => {
    const nowRef = { value: 1_000 };
    const breaker = makeBreaker(nowRef, 1);

    await expect(
      breaker.execute(async () => {
        throw new Error('first failure');
      })
    ).rejects.toThrow('first failure');

    nowRef.value += 1_001;
    await expect(
      breaker.execute(async () => {
        throw new Error('probe failed');
      })
    ).rejects.toThrow('probe failed');

    expect(breaker.snapshot()).toMatchObject({
      state: 'open',
      openedAtMs: 2_001,
    });
  });

  it('allows only one in-flight half-open probe', async () => {
    const nowRef = { value: 1_000 };
    const breaker = makeBreaker(nowRef, 1);

    await expect(
      breaker.execute(async () => {
        throw new Error('first failure');
      })
    ).rejects.toThrow('first failure');

    nowRef.value += 1_001;
    const gate = deferred<string>();
    const firstProbe = breaker.execute(() => gate.promise);
    const secondOperation = vi.fn(async () => 'blocked');

    await expect(breaker.execute(secondOperation)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError
    );
    expect(secondOperation).not.toHaveBeenCalled();

    gate.resolve('recovered');
    await expect(firstProbe).resolves.toBe('recovered');
  });

  it('emits structured state-change events', async () => {
    const nowRef = { value: 1_000 };
    const events: CircuitBreakerEvent[] = [];
    const breaker = makeBreaker(nowRef, 1, events);

    await expect(
      breaker.execute(async () => {
        throw new Error('first failure');
      })
    ).rejects.toThrow('first failure');
    await expect(breaker.execute(async () => 'blocked')).rejects.toBeInstanceOf(
      CircuitBreakerOpenError
    );

    nowRef.value += 1_001;
    await expect(breaker.execute(async () => 'recovered')).resolves.toBe(
      'recovered'
    );

    expect(events.map((event) => event.event)).toEqual([
      'circuit_open',
      'circuit_blocked',
      'circuit_half_open',
      'circuit_closed',
    ]);
    expect(events[0]).toMatchObject({
      service: 'test-service',
      state: 'open',
      previousState: 'closed',
      failureThreshold: 1,
    });
    expect(events[1]?.retryAfterMs).toBe(1_000);
  });
});
