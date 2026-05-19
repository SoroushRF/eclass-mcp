export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  openedAtMs: number | null;
  halfOpenInFlight: boolean;
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
  onEvent?: (event: CircuitBreakerEvent) => void;
}

export interface CircuitBreakerExecuteOptions {
  shouldRecordFailure?: (error: unknown) => boolean;
}

export type CircuitBreakerEventName =
  | 'circuit_open'
  | 'circuit_blocked'
  | 'circuit_half_open'
  | 'circuit_closed';

export interface CircuitBreakerEvent {
  event: CircuitBreakerEventName;
  service: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  retryAfterMs?: number;
  previousState?: CircuitBreakerState;
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly retryAfterMs: number,
    message = `Circuit breaker "${breakerName}" is open`
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAtMs: number | null = null;
  private halfOpenInFlight = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    if (options.failureThreshold < 1) {
      throw new Error('Circuit breaker failureThreshold must be at least 1');
    }
    if (options.cooldownMs < 0) {
      throw new Error('Circuit breaker cooldownMs must not be negative');
    }
    this.now = options.now ?? (() => Date.now());
  }

  async execute<T>(
    operation: () => Promise<T>,
    executeOptions: CircuitBreakerExecuteOptions = {}
  ): Promise<T> {
    const probe = this.reserveCall();

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      const shouldRecord = executeOptions.shouldRecordFailure?.(error) ?? true;
      if (shouldRecord) {
        this.recordFailure();
      }
      throw error;
    } finally {
      if (probe === 'half_open') {
        this.halfOpenInFlight = false;
      }
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.options.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.options.failureThreshold,
      cooldownMs: this.options.cooldownMs,
      openedAtMs: this.openedAtMs,
      halfOpenInFlight: this.halfOpenInFlight,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAtMs = null;
    this.halfOpenInFlight = false;
  }

  private reserveCall(): CircuitBreakerState {
    const now = this.now();

    if (this.state === 'open') {
      const retryAfterMs = this.retryAfterMs(now);
      if (retryAfterMs > 0) {
        this.emit('circuit_blocked', { retryAfterMs });
        throw new CircuitBreakerOpenError(
          this.options.name,
          retryAfterMs,
          `Circuit breaker "${this.options.name}" is open for ${retryAfterMs}ms`
        );
      }
      this.state = 'half_open';
      this.halfOpenInFlight = false;
      this.emit('circuit_half_open');
    }

    if (this.state === 'half_open') {
      if (this.halfOpenInFlight) {
        this.emit('circuit_blocked', { retryAfterMs: 0 });
        throw new CircuitBreakerOpenError(
          this.options.name,
          0,
          `Circuit breaker "${this.options.name}" is probing recovery`
        );
      }
      this.halfOpenInFlight = true;
      return 'half_open';
    }

    return 'closed';
  }

  private recordSuccess(): void {
    const previousState = this.state;
    const hadFailures = this.consecutiveFailures > 0;
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAtMs = null;
    if (previousState !== 'closed' || hadFailures) {
      this.emit('circuit_closed', { previousState });
    }
  }

  private recordFailure(): void {
    if (this.state === 'half_open') {
      this.open();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    const previousState = this.state;
    this.state = 'open';
    this.openedAtMs = this.now();
    this.halfOpenInFlight = false;
    this.emit('circuit_open', { previousState });
  }

  private retryAfterMs(now: number): number {
    if (this.openedAtMs === null) {
      return 0;
    }
    const elapsedMs = now - this.openedAtMs;
    return Math.max(0, this.options.cooldownMs - elapsedMs);
  }

  private emit(
    event: CircuitBreakerEventName,
    extra: Partial<
      Pick<CircuitBreakerEvent, 'retryAfterMs' | 'previousState'>
    > = {}
  ): void {
    this.options.onEvent?.({
      event,
      service: this.options.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.options.failureThreshold,
      cooldownMs: this.options.cooldownMs,
      ...extra,
    });
  }
}
