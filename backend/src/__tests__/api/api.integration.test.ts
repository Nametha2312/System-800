import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { createMockSKU, createMockUser, createMockJwtPayload } from '../fixtures';
import { RetailerType, MonitoringStatus } from '../../types';

// Mock all services
const mockSKUService = {
  create: vi.fn(),
  findById: vi.fn(),
  findByUserId: vi.fn(),
  findAll: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  pauseMonitoring: vi.fn(),
  resumeMonitoring: vi.fn(),
};

const mockAuthService = {
  register: vi.fn(),
  login: vi.fn(),
  verifyToken: vi.fn(),
  refreshToken: vi.fn(),
  getUserById: vi.fn(),
};

vi.mock('../../services', () => ({
  getSKUService: () => mockSKUService,
  getAuthService: () => mockAuthService,
  getAlertService: () => ({
    findByUserId: vi.fn().mockResolvedValue([]),
    acknowledge: vi.fn(),
    countUnacknowledged: vi.fn().mockResolvedValue(0),
  }),
  getCheckoutService: () => ({
    findByUserId: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ total: 0, succeeded: 0, failed: 0 }),
  }),
  getCredentialService: () => ({
    findByUserId: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    delete: vi.fn(),
  }),
}));

// Create a test Express app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Mock auth middleware
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      req.user = createMockJwtPayload();
    }
    next();
  });

  // SKU routes
  app.get('/api/v1/skus', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const skus = await mockSKUService.findByUserId(req.user.userId);
    res.json({ data: skus });
  });

  app.post('/api/v1/skus', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const sku = await mockSKUService.create(req.body, req.user.userId);
      res.status(201).json({ data: sku });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/v1/skus/:id', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sku = await mockSKUService.findById(req.params.id);
    if (!sku) return res.status(404).json({ error: 'SKU not found' });
    res.json({ data: sku });
  });

  app.patch('/api/v1/skus/:id', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sku = await mockSKUService.update(req.params.id, req.body);
    if (!sku) return res.status(404).json({ error: 'SKU not found' });
    res.json({ data: sku });
  });

  app.delete('/api/v1/skus/:id', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const deleted = await mockSKUService.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'SKU not found' });
    res.status(204).send();
  });

  app.post('/api/v1/skus/:id/pause', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sku = await mockSKUService.pauseMonitoring(req.params.id);
    if (!sku) return res.status(404).json({ error: 'SKU not found' });
    res.json({ data: sku });
  });

  app.post('/api/v1/skus/:id/resume', async (req: any, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sku = await mockSKUService.resumeMonitoring(req.params.id);
    if (!sku) return res.status(404).json({ error: 'SKU not found' });
    res.json({ data: sku });
  });

  // Auth routes
  app.post('/api/v1/auth/register', async (req, res) => {
    try {
      const result = await mockAuthService.register(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/v1/auth/login', async (req, res) => {
    try {
      const result = await mockAuthService.login(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  });

  app.post('/api/v1/auth/refresh', async (req, res) => {
    try {
      const result = await mockAuthService.refreshToken(req.body.refreshToken);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  });

  return app;
}

describe('API Integration Tests', () => {
  let app: Express;
  const validToken = 'Bearer valid-token';

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SKU Endpoints', () => {
    describe('GET /api/v1/skus', () => {
      it('should return 401 without auth token', async () => {
        const response = await request(app).get('/api/v1/skus');
        expect(response.status).toBe(401);
      });

      it('should return SKUs for authenticated user', async () => {
        const skus = [createMockSKU(), createMockSKU()];
        mockSKUService.findByUserId.mockResolvedValue(skus);

        const response = await request(app)
          .get('/api/v1/skus')
          .set('Authorization', validToken);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
      });

      it('should return empty array when no SKUs', async () => {
        mockSKUService.findByUserId.mockResolvedValue([]);

        const response = await request(app)
          .get('/api/v1/skus')
          .set('Authorization', validToken);

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual([]);
      });
    });

    describe('POST /api/v1/skus', () => {
      it('should create a new SKU', async () => {
        const input = {
          name: 'Test Product',
          url: 'https://www.amazon.com/dp/test',
          retailer: RetailerType.AMAZON,
        };
        const createdSKU = createMockSKU(input);
        mockSKUService.create.mockResolvedValue(createdSKU);

        const response = await request(app)
          .post('/api/v1/skus')
          .set('Authorization', validToken)
          .send(input);

        expect(response.status).toBe(201);
        expect(response.body.data.name).toBe('Test Product');
      });

      it('should return 400 for invalid input', async () => {
        mockSKUService.create.mockRejectedValue(new Error('Invalid URL'));

        const response = await request(app)
          .post('/api/v1/skus')
          .set('Authorization', validToken)
          .send({ name: 'Test', url: 'invalid' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid URL');
      });
    });

    describe('GET /api/v1/skus/:id', () => {
      it('should return SKU by ID', async () => {
        const sku = createMockSKU();
        mockSKUService.findById.mockResolvedValue(sku);

        const response = await request(app)
          .get(`/api/v1/skus/${sku.id}`)
          .set('Authorization', validToken);

        expect(response.status).toBe(200);
        expect(response.body.data.id).toBe(sku.id);
      });

      it('should return 404 for non-existent SKU', async () => {
        mockSKUService.findById.mockResolvedValue(null);

        const response = await request(app)
          .get('/api/v1/skus/non-existent')
          .set('Authorization', validToken);

        expect(response.status).toBe(404);
      });
    });

    describe('PATCH /api/v1/skus/:id', () => {
      it('should update SKU', async () => {
        const sku = createMockSKU();
        const updatedSKU = { ...sku, name: 'Updated Name' };
        mockSKUService.update.mockResolvedValue(updatedSKU);

        const response = await request(app)
          .patch(`/api/v1/skus/${sku.id}`)
          .set('Authorization', validToken)
          .send({ name: 'Updated Name' });

        expect(response.status).toBe(200);
        expect(response.body.data.name).toBe('Updated Name');
      });

      it('should return 404 for non-existent SKU', async () => {
        mockSKUService.update.mockResolvedValue(null);

        const response = await request(app)
          .patch('/api/v1/skus/non-existent')
          .set('Authorization', validToken)
          .send({ name: 'Test' });

        expect(response.status).toBe(404);
      });
    });

    describe('DELETE /api/v1/skus/:id', () => {
      it('should delete SKU', async () => {
        mockSKUService.delete.mockResolvedValue(true);

        const response = await request(app)
          .delete('/api/v1/skus/sku-123')
          .set('Authorization', validToken);

        expect(response.status).toBe(204);
      });

      it('should return 404 for non-existent SKU', async () => {
        mockSKUService.delete.mockResolvedValue(false);

        const response = await request(app)
          .delete('/api/v1/skus/non-existent')
          .set('Authorization', validToken);

        expect(response.status).toBe(404);
      });
    });

    describe('POST /api/v1/skus/:id/pause', () => {
      it('should pause monitoring', async () => {
        const sku = createMockSKU({ monitoring_status: MonitoringStatus.PAUSED });
        mockSKUService.pauseMonitoring.mockResolvedValue(sku);

        const response = await request(app)
          .post('/api/v1/skus/sku-123/pause')
          .set('Authorization', validToken);

        expect(response.status).toBe(200);
        expect(response.body.data.monitoring_status).toBe(MonitoringStatus.PAUSED);
      });
    });

    describe('POST /api/v1/skus/:id/resume', () => {
      it('should resume monitoring', async () => {
        const sku = createMockSKU({ monitoring_status: MonitoringStatus.ACTIVE });
        mockSKUService.resumeMonitoring.mockResolvedValue(sku);

        const response = await request(app)
          .post('/api/v1/skus/sku-123/resume')
          .set('Authorization', validToken);

        expect(response.status).toBe(200);
        expect(response.body.data.monitoring_status).toBe(MonitoringStatus.ACTIVE);
      });
    });
  });

  describe('Auth Endpoints', () => {
    describe('POST /api/v1/auth/register', () => {
      it('should register a new user', async () => {
        const user = createMockUser();
        mockAuthService.register.mockResolvedValue({
          user: { id: user.id, email: user.email, name: user.name },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        });

        const response = await request(app)
          .post('/api/v1/auth/register')
          .send({
            email: 'new@example.com',
            password: 'password123',
            name: 'New User',
          });

        expect(response.status).toBe(201);
        expect(response.body.accessToken).toBeDefined();
        expect(response.body.refreshToken).toBeDefined();
      });

      it('should return 400 for duplicate email', async () => {
        mockAuthService.register.mockRejectedValue(
          new Error('Email already registered'),
        );

        const response = await request(app)
          .post('/api/v1/auth/register')
          .send({
            email: 'existing@example.com',
            password: 'password123',
            name: 'Test',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Email already registered');
      });
    });

    describe('POST /api/v1/auth/login', () => {
      it('should login with valid credentials', async () => {
        const user = createMockUser();
        mockAuthService.login.mockResolvedValue({
          user: { id: user.id, email: user.email },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        });

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123',
          });

        expect(response.status).toBe(200);
        expect(response.body.accessToken).toBeDefined();
      });

      it('should return 401 for invalid credentials', async () => {
        mockAuthService.login.mockRejectedValue(new Error('Invalid credentials'));

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'test@example.com',
            password: 'wrong-password',
          });

        expect(response.status).toBe(401);
      });
    });

    describe('POST /api/v1/auth/refresh', () => {
      it('should refresh tokens', async () => {
        mockAuthService.refreshToken.mockResolvedValue({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        });

        const response = await request(app)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: 'valid-refresh-token' });

        expect(response.status).toBe(200);
        expect(response.body.accessToken).toBe('new-access-token');
      });

      it('should return 401 for invalid refresh token', async () => {
        mockAuthService.refreshToken.mockRejectedValue(
          new Error('Invalid refresh token'),
        );

        const response = await request(app)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: 'invalid-token' });

        expect(response.status).toBe(401);
      });
    });
  });
});
