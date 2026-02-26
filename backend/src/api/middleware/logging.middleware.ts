import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { getLogger } from '../../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../../observability/metrics.js';
import { AuthenticatedRequest } from './auth.middleware.js';

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  };
}

export function requestLoggerMiddleware() {
  const logger = getLogger().child({ middleware: 'requestLogger' });

  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;

    logger.info('Request started', {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const originalEnd = res.end.bind(res);

    res.end = function (
      this: Response,
      chunk?: unknown,
      encodingOrCb?: BufferEncoding | (() => void),
      cb?: () => void,
    ): Response {
      const duration = Date.now() - startTime;
      const userId = (req as AuthenticatedRequest).user?.userId;

      logger.info('Request completed', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userId,
      });

      const metrics = getMetricsCollector();
      metrics.recordLatency(MetricNames.API_LATENCY, duration);

      // Handle different overloads
      if (typeof encodingOrCb === 'function') {
        return originalEnd(chunk, encodingOrCb);
      } else if (encodingOrCb !== undefined) {
        return originalEnd(chunk, encodingOrCb, cb);
      } else if (chunk !== undefined) {
        return originalEnd(chunk);
      }
      return originalEnd();
    };

    next();
  };
}

export function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'encryptedPassword'];
  const sanitized = { ...body };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}
