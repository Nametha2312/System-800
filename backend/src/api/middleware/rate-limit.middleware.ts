import { Request, Response, NextFunction } from 'express';
import { getLogger } from '../../observability/logger.js';
import { AuthenticatedRequest } from './auth.middleware.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  skipFailedRequests?: boolean;
  handler?: (req: Request, res: Response, next: NextFunction) => void;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function cleanupStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

setInterval(cleanupStore, 60000);

export function rateLimitMiddleware(options: RateLimitOptions) {
  const logger = getLogger().child({ middleware: 'rateLimit' });
  const {
    windowMs,
    maxRequests,
    keyPrefix = 'rl',
    skipFailedRequests = false,
    handler,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = (req as AuthenticatedRequest).user?.userId;
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${keyPrefix}:${userId ?? ip}`;

    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (entry === undefined || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetTime = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    if (entry.count > maxRequests) {
      logger.warn('Rate limit exceeded', {
        key,
        count: entry.count,
        maxRequests,
        ip,
        userId,
        path: req.path,
      });

      if (handler !== undefined) {
        handler(req, res, next);
        return;
      }

      res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: resetTime,
      });
      return;
    }

    if (skipFailedRequests) {
      const originalJson = res.json.bind(res);
      res.json = function (body: unknown): Response {
        if (res.statusCode >= 400) {
          entry!.count--;
        }
        return originalJson(body);
      };
    }

    next();
  };
}

export function createApiRateLimit(): ReturnType<typeof rateLimitMiddleware> {
  return rateLimitMiddleware({
    windowMs: 60000,
    maxRequests: 100,
    keyPrefix: 'api',
    skipFailedRequests: true,
  });
}

export function createAuthRateLimit(): ReturnType<typeof rateLimitMiddleware> {
  return rateLimitMiddleware({
    windowMs: 900000,
    maxRequests: 10,
    keyPrefix: 'auth',
  });
}

export function createCheckoutRateLimit(): ReturnType<typeof rateLimitMiddleware> {
  return rateLimitMiddleware({
    windowMs: 60000,
    maxRequests: 5,
    keyPrefix: 'checkout',
  });
}

export function createStrictRateLimit(): ReturnType<typeof rateLimitMiddleware> {
  return rateLimitMiddleware({
    windowMs: 60000,
    maxRequests: 10,
    keyPrefix: 'strict',
  });
}
