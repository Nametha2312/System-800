import { ErrorCategory } from '../types/index.js';
import { getLogger } from '../observability/logger.js';

const logger = getLogger();

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterFactor?: number;
  readonly retryableErrors?: ErrorCategory[];
}

export interface RetryResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: Error | undefined;
  readonly attempts: number;
  readonly totalTimeMs: number;
}

export interface RetryContext {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly lastError?: Error | undefined;
  readonly nextDelayMs: number;
}

export type RetryableFn<T> = (context: RetryContext) => Promise<T>;
export type ShouldRetryFn = (error: Error, attempt: number) => boolean;

const DEFAULT_RETRYABLE_ERRORS: ErrorCategory[] = [
  ErrorCategory.NETWORK_ERROR,
  ErrorCategory.TIMEOUT_ERROR,
  ErrorCategory.RATE_LIMITED,
  ErrorCategory.REDIS_ERROR,
  ErrorCategory.DATABASE_ERROR,
];

function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number = 0.1,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(cappedDelay + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRetryableError(error: Error, retryableCategories?: ErrorCategory[]): boolean {
  const categories = retryableCategories ?? DEFAULT_RETRYABLE_ERRORS;

  const errorMessage = error.message.toLowerCase();

  if (errorMessage.includes('network') || errorMessage.includes('econnrefused')) {
    return categories.includes(ErrorCategory.NETWORK_ERROR);
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('etimedout')) {
    return categories.includes(ErrorCategory.TIMEOUT_ERROR);
  }

  if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
    return categories.includes(ErrorCategory.RATE_LIMITED);
  }

  if (errorMessage.includes('redis')) {
    return categories.includes(ErrorCategory.REDIS_ERROR);
  }

  if (
    errorMessage.includes('database') ||
    errorMessage.includes('postgres') ||
    errorMessage.includes('connection')
  ) {
    return categories.includes(ErrorCategory.DATABASE_ERROR);
  }

  return false;
}

export async function withRetry<T>(
  fn: RetryableFn<T>,
  config: RetryConfig,
  shouldRetry?: ShouldRetryFn,
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const nextDelayMs = calculateBackoffDelay(
      attempt,
      config.baseDelayMs,
      config.maxDelayMs,
      config.jitterFactor,
    );

    const context: RetryContext = {
      attempt,
      maxAttempts: config.maxAttempts,
      lastError,
      nextDelayMs,
    };

    try {
      const data = await fn(context);
      return {
        success: true,
        data,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const shouldRetryDefault = isRetryableError(lastError, config.retryableErrors);
      // If retryableErrors is explicitly set in config, respect it. Otherwise retry all errors.
      const hasExplicitCategories = config.retryableErrors !== undefined && config.retryableErrors.length > 0;
      const defaultShouldRetry = hasExplicitCategories ? shouldRetryDefault : true;
      const shouldRetryResult = shouldRetry?.(lastError, attempt) ?? defaultShouldRetry;

      if (attempt < config.maxAttempts && shouldRetryResult) {
        logger.warn(`Retry attempt ${attempt}/${config.maxAttempts} failed, retrying in ${nextDelayMs}ms`, {
          attemptNumber: attempt,
          durationMs: nextDelayMs,
        });
        await sleep(nextDelayMs);
      } else {
        logger.error(`All retry attempts exhausted`, lastError, {
          attemptNumber: attempt,
        });
        // Exit the loop when shouldRetry returns false or max attempts reached
        break;
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: lastError !== undefined ? Math.min(config.maxAttempts, config.maxAttempts) : config.maxAttempts,
    totalTimeMs: Date.now() - startTime,
  };
}

export function createRetryableOperation<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
): () => Promise<RetryResult<T>> {
  return () => withRetry(() => operation(), config);
}

export { calculateBackoffDelay, sleep };
