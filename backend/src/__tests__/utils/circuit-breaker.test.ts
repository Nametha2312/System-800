import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreakerState } from '../../types/index.js';

// Mock logger and metrics before importing circuit-breaker
vi.mock('../../observability/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../observability/metrics.js', () => ({
  getMetricsCollector: () => ({
    incrementCounter: vi.fn(),
    setGauge: vi.fn(),
  }),
  MetricNames: {
    CIRCUIT_BREAKER_STATE: 'circuit_breaker_state',
  },
}));

// Import after mocks
import {
  getCircuitBreaker,
  resetAllCircuitBreakers,
  removeCircuitBreaker,
  getAllCircuitBreakers,
  CircuitBreakerError,
} from '../../utils/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllCircuitBreakers();
    // Clear all circuit breakers between tests
    for (const name of getAllCircuitBreakers().keys()) {
      removeCircuitBreaker(name);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should start in CLOSED state', () => {
      const cb = getCircuitBreaker('test-init-1', {
        threshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      expect(cb.getStatus().state).toBe(CircuitBreakerState.CLOSED);
    });

    it('should return the same instance for the same name', () => {
      const cb1 = getCircuitBreaker('test-same-1', {
        threshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const cb2 = getCircuitBreaker('test-same-1', {
        threshold: 5,
        resetTimeoutMs: 2000,
        halfOpenMaxRequests: 5,
      });
      expect(cb1).toBe(cb2);
    });
  });

  describe('CLOSED state', () => {
    it('should execute functions successfully', async () => {
      const cb = getCircuitBreaker('test-closed-1', {
        threshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const fn = vi.fn().mockResolvedValue('success');

      const result = await cb.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors without opening if under threshold', async () => {
      const cb = getCircuitBreaker('test-closed-2', {
        threshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const fn = vi.fn().mockRejectedValue(new Error('test error'));

      await expect(cb.execute(fn)).rejects.toThrow('test error');
      await expect(cb.execute(fn)).rejects.toThrow('test error');

      expect(cb.getStatus().state).toBe(CircuitBreakerState.CLOSED);
      expect(cb.getStatus().failureCount).toBe(2);
    });

    it('should open after reaching failure threshold', async () => {
      const cb = getCircuitBreaker('test-closed-3', {
        threshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const fn = vi.fn().mockRejectedValue(new Error('test error'));

      await expect(cb.execute(fn)).rejects.toThrow('test error');
      await expect(cb.execute(fn)).rejects.toThrow('test error');
      await expect(cb.execute(fn)).rejects.toThrow('test error');

      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);
    });

    it('should reset failure count after successful call', async () => {
      const cb = getCircuitBreaker('test-closed-4', {
        threshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();
      await cb.execute(successFn);

      // After success, failure count resets
      expect(cb.getStatus().failureCount).toBe(0);
    });
  });

  describe('OPEN state', () => {
    it('should reject calls immediately without executing function', async () => {
      const cb = getCircuitBreaker('test-open-1', {
        threshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const anotherFn = vi.fn().mockResolvedValue('should not run');

      await expect(cb.execute(failFn)).rejects.toThrow('fail');
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);

      await expect(cb.execute(anotherFn)).rejects.toThrow(CircuitBreakerError);
      expect(anotherFn).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const cb = getCircuitBreaker('test-open-2', {
        threshold: 1,
        resetTimeoutMs: 5000,
        halfOpenMaxRequests: 3,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);

      // Advance time past reset timeout
      await vi.advanceTimersByTimeAsync(5001);

      // The transition happens on next call attempt
      const successFn = vi.fn().mockResolvedValue('success');
      await cb.execute(successFn);
      
      // It should have transitioned through HALF_OPEN
      expect(successFn).toHaveBeenCalled();
    });

    it('should report correct status while OPEN', async () => {
      const cb = getCircuitBreaker('test-open-3', {
        threshold: 1,
        resetTimeoutMs: 5000,
        halfOpenMaxRequests: 3,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(cb.execute(failFn)).rejects.toThrow();

      const status = cb.getStatus();
      expect(status.state).toBe(CircuitBreakerState.OPEN);
      expect(status.failureCount).toBe(1);
      expect(status.nextRetryAt).toBeDefined();
      expect(status.lastFailureAt).toBeDefined();
    });
  });

  describe('HALF_OPEN state', () => {
    it('should close after successful requests', async () => {
      const cb = getCircuitBreaker('test-half-1', {
        threshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 2,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Open the circuit
      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);

      // Wait for timeout
      await vi.advanceTimersByTimeAsync(1001);

      // Execute successful requests
      await cb.execute(successFn);
      await cb.execute(successFn);

      expect(cb.getStatus().state).toBe(CircuitBreakerState.CLOSED);
    });

    it('should reopen after failure in HALF_OPEN state', async () => {
      const cb = getCircuitBreaker('test-half-2', {
        threshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 2,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);

      // Wait for timeout
      await vi.advanceTimersByTimeAsync(1001);

      // Execute failing request in HALF_OPEN
      await expect(cb.execute(failFn)).rejects.toThrow();

      // Should be back to OPEN
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);
    });

    it('should limit requests in HALF_OPEN state', async () => {
      const cb = getCircuitBreaker('test-half-3', {
        threshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 2,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(cb.execute(failFn)).rejects.toThrow();

      // Wait for timeout
      await vi.advanceTimersByTimeAsync(1001);

      // Create slow function that doesn't resolve immediately
      let resolveFirst: () => void = () => {};
      let resolveSecond: () => void = () => {};
      const slowFn1 = vi.fn().mockReturnValue(new Promise<string>(r => { resolveFirst = () => r('1'); }));
      const slowFn2 = vi.fn().mockReturnValue(new Promise<string>(r => { resolveSecond = () => r('2'); }));
      const thirdFn = vi.fn().mockResolvedValue('3');

      // Start two requests
      const promise1 = cb.execute(slowFn1);
      const promise2 = cb.execute(slowFn2);

      // Third request should be rejected
      await expect(cb.execute(thirdFn)).rejects.toThrow(CircuitBreakerError);
      expect(thirdFn).not.toHaveBeenCalled();

      // Complete the first two
      resolveFirst();
      resolveSecond();
      await promise1;
      await promise2;
    });
  });

  describe('manual controls', () => {
    it('should reset to CLOSED state', async () => {
      const cb = getCircuitBreaker('test-manual-1', {
        threshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);

      cb.reset();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.CLOSED);
    });

    it('should force open', () => {
      const cb = getCircuitBreaker('test-manual-2', {
        threshold: 3,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      expect(cb.getStatus().state).toBe(CircuitBreakerState.CLOSED);

      cb.forceOpen();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);
    });

    it('should force close', async () => {
      const cb = getCircuitBreaker('test-manual-3', {
        threshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(cb.execute(failFn)).rejects.toThrow();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.OPEN);

      cb.forceClose();
      expect(cb.getStatus().state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('circuit breaker management', () => {
    it('should get all circuit breakers', () => {
      getCircuitBreaker('mgmt-1', { threshold: 3, resetTimeoutMs: 1000, halfOpenMaxRequests: 3 });
      getCircuitBreaker('mgmt-2', { threshold: 3, resetTimeoutMs: 1000, halfOpenMaxRequests: 3 });

      const all = getAllCircuitBreakers();
      expect(all.size).toBeGreaterThanOrEqual(2);
      expect(all.has('mgmt-1')).toBe(true);
      expect(all.has('mgmt-2')).toBe(true);
    });

    it('should remove circuit breaker', () => {
      getCircuitBreaker('remove-test', { threshold: 3, resetTimeoutMs: 1000, halfOpenMaxRequests: 3 });

      const removed = removeCircuitBreaker('remove-test');
      expect(removed).toBe(true);
      expect(getAllCircuitBreakers().has('remove-test')).toBe(false);
    });

    it('should return false when removing non-existent circuit breaker', () => {
      const removed = removeCircuitBreaker('non-existent');
      expect(removed).toBe(false);
    });

    it('should reset all circuit breakers', async () => {
      const cb1 = getCircuitBreaker('reset-all-1', { threshold: 1, resetTimeoutMs: 1000, halfOpenMaxRequests: 3 });
      const cb2 = getCircuitBreaker('reset-all-2', { threshold: 1, resetTimeoutMs: 1000, halfOpenMaxRequests: 3 });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(cb1.execute(failFn)).rejects.toThrow();
      await expect(cb2.execute(failFn)).rejects.toThrow();

      expect(cb1.getStatus().state).toBe(CircuitBreakerState.OPEN);
      expect(cb2.getStatus().state).toBe(CircuitBreakerState.OPEN);

      resetAllCircuitBreakers();

      expect(cb1.getStatus().state).toBe(CircuitBreakerState.CLOSED);
      expect(cb2.getStatus().state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('CircuitBreakerError', () => {
    it('should include state in the error', async () => {
      const cb = getCircuitBreaker('error-test', {
        threshold: 1,
        resetTimeoutMs: 1000,
        halfOpenMaxRequests: 3,
      });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const otherFn = vi.fn().mockResolvedValue('success');

      await expect(cb.execute(failFn)).rejects.toThrow('fail');

      try {
        await cb.execute(otherFn);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerError);
        expect((error as CircuitBreakerError).state).toBe(CircuitBreakerState.OPEN);
      }
    });
  });
});
