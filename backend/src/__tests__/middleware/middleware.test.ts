import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, createMockResponse, createMockNext, createMockJwtPayload } from '../fixtures';

// Mock auth service
const mockAuthService = {
  verifyToken: vi.fn(),
};

vi.mock('../../services', () => ({
  getAuthService: () => mockAuthService,
}));

// Auth middleware implementation
async function authMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await mockAuthService.verifyToken(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional auth middleware
async function optionalAuthMiddleware(req: any, _res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const payload = await mockAuthService.verifyToken(token);
    req.user = payload;
  } catch {
    // Ignore auth errors in optional auth
  }

  next();
}

// Admin middleware
function adminMiddleware(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

// Rate limit middleware (simplified)
function createRateLimiter(options: { windowMs: number; max: number }) {
  const requests: Map<string, { count: number; resetAt: number }> = new Map();

  return (req: any, res: any, next: any) => {
    const ip = req.ip || '127.0.0.1';
    const now = Date.now();

    let record = requests.get(ip);

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + options.windowMs };
      requests.set(ip, record);
    }

    record.count++;

    if (record.count > options.max) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}

// Error middleware
function errorMiddleware(err: any, _req: any, res: any, _next: any) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

// Logging middleware
function loggingMiddleware(req: any, res: any, next: any) {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}

describe('Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authMiddleware', () => {
    it('should pass with valid token', async () => {
      const payload = createMockJwtPayload();
      mockAuthService.verifyToken.mockResolvedValue(payload);

      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(mockAuthService.verifyToken).toHaveBeenCalledWith('valid-token');
      expect((req as any).user).toEqual(payload);
      expect(next).toHaveBeenCalled();
    });

    it('should reject missing authorization header', async () => {
      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('authorization') }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid authorization format', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Basic credentials' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid token', async () => {
      mockAuthService.verifyToken.mockRejectedValue(new Error('Invalid token'));

      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid-token' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid') }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject expired token', async () => {
      mockAuthService.verifyToken.mockRejectedValue(new Error('Token expired'));

      const req = createMockRequest({
        headers: { authorization: 'Bearer expired-token' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuthMiddleware', () => {
    it('should pass without authorization header', async () => {
      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthMiddleware(req, res, next);

      expect((req as any).user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('should attach user with valid token', async () => {
      const payload = createMockJwtPayload();
      mockAuthService.verifyToken.mockResolvedValue(payload);

      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthMiddleware(req, res, next);

      expect((req as any).user).toEqual(payload);
      expect(next).toHaveBeenCalled();
    });

    it('should continue without user on invalid token', async () => {
      mockAuthService.verifyToken.mockRejectedValue(new Error('Invalid'));

      const req = createMockRequest({
        headers: { authorization: 'Bearer invalid-token' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await optionalAuthMiddleware(req, res, next);

      expect((req as any).user).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('adminMiddleware', () => {
    it('should pass for admin user', () => {
      const req = createMockRequest();
      (req as any).user = { role: 'admin' };
      const res = createMockResponse();
      const next = createMockNext();

      adminMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject non-admin user', () => {
      const req = createMockRequest();
      (req as any).user = { role: 'user' };
      const res = createMockResponse();
      const next = createMockNext();

      adminMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Admin') }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated request', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      adminMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('rateLimiter', () => {
    it('should allow requests within limit', () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
      const req = createMockRequest({ ip: '192.168.1.1' });
      const res = createMockResponse();
      const next = createMockNext();

      for (let i = 0; i < 5; i++) {
        limiter(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(5);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests exceeding limit', () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 3 });
      const req = createMockRequest({ ip: '192.168.1.2' });
      const res = createMockResponse();
      const next = createMockNext();

      for (let i = 0; i < 5; i++) {
        limiter(req, res, next);
      }

      expect(next).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should track different IPs separately', () => {
      const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
      const res = createMockResponse();
      const next = createMockNext();

      const req1 = createMockRequest({ ip: '192.168.1.3' });
      const req2 = createMockRequest({ ip: '192.168.1.4' });

      limiter(req1, res, next);
      limiter(req1, res, next);
      limiter(req2, res, next);
      limiter(req2, res, next);

      expect(next).toHaveBeenCalledTimes(4);
    });
  });

  describe('errorMiddleware', () => {
    it('should handle errors with status code', () => {
      const err = { statusCode: 400, message: 'Bad Request' };
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      errorMiddleware(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Bad Request' }),
      );
    });

    it('should default to 500 for unknown errors', () => {
      const err = { message: 'Something went wrong' };
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      errorMiddleware(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('should include stack trace in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const err = { message: 'Error', stack: 'Error stack trace' };
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      errorMiddleware(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ stack: 'Error stack trace' }),
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('loggingMiddleware', () => {
    it('should log request details', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const req = createMockRequest({ method: 'GET', path: '/api/test' });
      const res = createMockResponse();
      const next = createMockNext();

      // Mock res.on for finish event
      let finishCallback: (() => void) | undefined;
      (res as any).on = vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb;
      });
      (res as any).statusCode = 200;

      loggingMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();

      // Simulate response finish
      if (finishCallback) finishCallback();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('GET /api/test'),
      );
    });
  });
});
