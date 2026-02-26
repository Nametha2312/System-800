import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { getLogger } from '../../observability/logger.js';
import { getErrorService } from '../../services/error.service.js';
import { ErrorCategory, ErrorSeverity } from '../../types/index.js';
import { AuthenticatedRequest } from './auth.middleware.js';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export function errorMiddleware() {
  const logger = getLogger().child({ middleware: 'error' });

  return async (
    err: ApiError,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> => {
    const requestId = req.headers['x-request-id'] as string | undefined;
    const userId = (req as AuthenticatedRequest).user?.userId;

    let statusCode = err.statusCode ?? 500;
    let message = err.message;
    let code = err.code ?? 'INTERNAL_ERROR';
    let details: unknown = err.details;

    if (err instanceof ZodError) {
      statusCode = 400;
      code = 'VALIDATION_ERROR';
      message = 'Validation failed';
      details = err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
    }

    if (message.includes('not found') || message.includes('Not found')) {
      statusCode = 404;
      code = 'NOT_FOUND';
    }

    if (message.includes('already exists') || message.includes('duplicate')) {
      statusCode = 409;
      code = 'CONFLICT';
    }

    if (message.includes('unauthorized') || message.includes('Unauthorized')) {
      statusCode = 401;
      code = 'UNAUTHORIZED';
    }

    if (message.includes('forbidden') || message.includes('Forbidden')) {
      statusCode = 403;
      code = 'FORBIDDEN';
    }

    logger.error({
      statusCode,
      code,
      message,
      path: req.path,
      method: req.method,
      requestId,
      userId,
      stack: err.stack,
    }, 'API error');

    if (statusCode >= 500) {
      try {
        const errorService = getErrorService();
        await errorService.logError({
          category: ErrorCategory.UNKNOWN,
          severity: ErrorSeverity.ERROR,
          message: err.message,
          stack: err.stack,
          context: {
            path: req.path,
            method: req.method,
            query: req.query,
            body: req.body,
          },
          userId,
          requestId,
        });
      } catch (logErr) {
        logger.error({ err: logErr }, 'Logging error');
      }
    }

    const response: Record<string, unknown> = {
      error: code,
      message,
    };

    if (details !== undefined) {
      response['details'] = details;
    }

    if (requestId !== undefined) {
      response['requestId'] = requestId;
    }

    res.status(statusCode).json(response);
  };
}

export function notFoundMiddleware() {
  return (req: Request, res: Response): void => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    });
  };
}

export function createApiError(
  message: string,
  statusCode = 500,
  code?: string,
  details?: unknown,
): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
