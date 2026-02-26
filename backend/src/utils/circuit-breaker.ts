import { CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerStatus } from '../types/index.js';
import { getLogger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';

// Export CircuitState alias for test compatibility
export { CircuitBreakerState as CircuitState };

// Export options interface for test compatibility
export type CircuitBreakerOptions = CircuitBreakerConfig & {
  failureThreshold?: number;
  resetTimeoutMs?: number;
};

const logger = getLogger();
const metrics = getMetricsCollector();

export interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  getStatus(): CircuitBreakerStatus;
  reset(): void;
  forceOpen(): void;
  forceClose(): void;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitBreakerState,
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

class CircuitBreakerImpl implements CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private halfOpenRequests: number = 0;
  private lastFailureAt: Date | null = null;
  private nextRetryAt: Date | null = null;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitBreakerError(
        `Circuit breaker "${this.name}" is open. Retry after ${this.nextRetryAt?.toISOString() ?? 'unknown'}`,
        this.state,
      );
    }

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenRequests++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private canExecute(): boolean {
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        if (this.nextRetryAt !== null && Date.now() >= this.nextRetryAt.getTime()) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        return this.halfOpenRequests < this.config.halfOpenMaxRequests;
    }
  }

  private onSuccess(): void {
    this.successCount++;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.successCount >= this.config.halfOpenMaxRequests) {
        this.transitionToClosed();
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureAt = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.transitionToOpen();
    } else if (this.state === CircuitBreakerState.CLOSED) {
      if (this.failureCount >= this.config.threshold) {
        this.transitionToOpen();
      }
    }
  }

  private transitionToOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.nextRetryAt = new Date(Date.now() + this.config.resetTimeoutMs);
    this.halfOpenRequests = 0;
    this.successCount = 0;

    logger.warn(`Circuit breaker "${this.name}" opened`, {
      failureCount: this.failureCount,
      nextRetryAt: this.nextRetryAt.toISOString(),
    });

    metrics.setGauge(MetricNames.CIRCUIT_BREAKER_STATE, 1, { name: this.name, state: 'open' });
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitBreakerState.HALF_OPEN;
    this.halfOpenRequests = 0;
    this.successCount = 0;

    logger.info(`Circuit breaker "${this.name}" half-opened`);

    metrics.setGauge(MetricNames.CIRCUIT_BREAKER_STATE, 0.5, { name: this.name, state: 'half_open' });
  }

  private transitionToClosed(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequests = 0;
    this.nextRetryAt = null;

    logger.info(`Circuit breaker "${this.name}" closed`);

    metrics.setGauge(MetricNames.CIRCUIT_BREAKER_STATE, 0, { name: this.name, state: 'closed' });
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      nextRetryAt: this.nextRetryAt,
    };
  }

  reset(): void {
    this.transitionToClosed();
    this.lastFailureAt = null;
    logger.info(`Circuit breaker "${this.name}" manually reset`);
  }

  forceOpen(): void {
    this.transitionToOpen();
    logger.warn(`Circuit breaker "${this.name}" manually forced open`);
  }

  forceClose(): void {
    this.transitionToClosed();
    logger.info(`Circuit breaker "${this.name}" manually forced closed`);
  }
}

const circuitBreakers: Map<string, CircuitBreaker> = new Map();

export function getCircuitBreaker(name: string, config: CircuitBreakerConfig): CircuitBreaker {
  let breaker = circuitBreakers.get(name);

  if (breaker === undefined) {
    breaker = new CircuitBreakerImpl(name, config);
    circuitBreakers.set(name, breaker);
    logger.debug(`Circuit breaker "${name}" created`);
  }

  return breaker;
}

export function getAllCircuitBreakers(): Map<string, CircuitBreaker> {
  return new Map(circuitBreakers);
}

export function resetAllCircuitBreakers(): void {
  for (const [, breaker] of circuitBreakers.entries()) {
    breaker.reset();
  }
  logger.info('All circuit breakers reset');
}

export function removeCircuitBreaker(name: string): boolean {
  return circuitBreakers.delete(name);
}

export { CircuitBreakerImpl };
