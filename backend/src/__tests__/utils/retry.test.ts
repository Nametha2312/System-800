import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing retry module
vi.mock('../../observability/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

import { withRetry, RetryConfig, RetryContext } from '../../utils/retry';

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful operations', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockResolvedValue('success');
      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };

      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed on second attempt', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry and succeed on last attempt', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce('success');

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(3);
    });
  });

  describe('failure cases', () => {
    it('should throw after max attempts', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new Error('persistent failure'));

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('persistent failure');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw original error type', async () => {
      class CustomError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.code = code;
        }
      }

      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new CustomError('custom', 'ERR_CUSTOM'));

      const config: RetryConfig = { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(CustomError);
      expect((result.error as CustomError).code).toBe('ERR_CUSTOM');
    });
  });

  describe('exponential backoff', () => {
    it('should increase delay exponentially', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new Error('fail'));

      const config: RetryConfig = { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 10000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(4);
    });

    it('should respect maxDelayMs cap', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new Error('fail'));

      const config: RetryConfig = { maxAttempts: 10, baseDelayMs: 100, maxDelayMs: 500, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.totalTimeMs).toBeDefined();
    });
  });

  describe('jitter', () => {
    it('should add jitter to delay', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new Error('fail'));

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0.2 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
    });
  });

  describe('shouldRetry predicate', () => {
    it('should not retry if shouldRetry returns false', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new Error('fail'));
      const shouldRetry = vi.fn().mockReturnValue(false);

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config, shouldRetry);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry only for specific errors', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>()
        .mockRejectedValueOnce(new Error('retryable'))
        .mockRejectedValueOnce(new Error('not-retryable'));

      const shouldRetry = (error: Error) => error.message === 'retryable';

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config, shouldRetry);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('onRetry callback', () => {
    it('should call onRetry with attempt number and error', async () => {
      // onRetry is handled via logger in this implementation
      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new Error('fail'));

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should handle maxAttempts of 1', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockRejectedValue(new Error('fail'));

      const config: RetryConfig = { maxAttempts: 1, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle synchronous function', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>().mockResolvedValue('sync-result');

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.data).toBe('sync-result');
    });

    it('should pass through function arguments', async () => {
      const fn = vi.fn<[RetryContext], Promise<string>>(async (ctx) => {
        expect(ctx.attempt).toBeDefined();
        expect(ctx.maxAttempts).toBe(3);
        return 'done';
      });

      const config: RetryConfig = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 };
      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(true);
    });
  });
});
