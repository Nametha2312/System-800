import { Request, Response, NextFunction } from 'express';
import { getAuthService, TokenPayload } from '../../services/auth.service.js';
import { getLogger } from '../../observability/logger.js';
import { UserRole } from '../../types/index.js';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function authMiddleware() {
  const logger = getLogger().child({ middleware: 'auth' });

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
      logger.debug('Missing or invalid authorization header');
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header',
      });
      return;
    }

    const token = authHeader.slice(7);

    try {
      const authService = getAuthService();
      const payload = await authService.validateToken(token);

      if (payload === null) {
        logger.debug('Invalid or expired token');
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        });
        return;
      }

      req.user = payload;
      next();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Auth middleware error');
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication failed',
      });
    }
  };
}

export function optionalAuthMiddleware() {
  const logger = getLogger().child({ middleware: 'optionalAuth' });

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.slice(7);

    try {
      const authService = getAuthService();
      const payload = await authService.validateToken(token);

      if (payload !== null) {
        req.user = payload;
      }
    } catch (error) {
      logger.debug('Optional auth failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  const logger = getLogger().child({ middleware: 'requireRole' });

  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void => {
    if (req.user === undefined) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Access denied - insufficient role', {
        userId: req.user.userId,
        userRole: req.user.role,
        requiredRoles: roles,
      });
      res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
}
