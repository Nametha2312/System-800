import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAlert } from '../fixtures';
import { AlertType } from '../../types/index.js';

// Mock dependencies
const mockAlertRepository = {
  create: vi.fn(),
  findById: vi.fn(),
  findAll: vi.fn(),
  findWhere: vi.fn(),
  findUnacknowledged: vi.fn(),
  acknowledge: vi.fn(),
  acknowledgeAll: vi.fn(),
  findBySKU: vi.fn(),
  findByDateRange: vi.fn(),
};

const mockMetricsCollector = {
  incrementCounter: vi.fn(),
  setGauge: vi.fn(),
};

// Mock repository
vi.mock('../../persistence/repositories/alert.repository.js', () => ({
  getAlertRepository: () => mockAlertRepository,
}));

// Mock logger
vi.mock('../../observability/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

// Mock metrics
vi.mock('../../observability/metrics.js', () => ({
  getMetricsCollector: () => mockMetricsCollector,
  MetricNames: {
    ALERTS_GENERATED: 'alerts_generated',
    ACTIVE_ALERTS: 'active_alerts',
  },
}));

// Import service after mocks
import { AlertServiceImpl } from '../../services/alert.service.js';

describe('AlertService', () => {
  let service: InstanceType<typeof AlertServiceImpl>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AlertServiceImpl(mockAlertRepository as any);
    
    // Default mock for getPendingCount
    mockAlertRepository.findWhere.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 1, total: 0, totalPages: 0 },
    });
  });

  describe('createAlert', () => {
    it('should create a new alert', async () => {
      const input = {
        skuId: 'sku-123',
        type: AlertType.STOCK_AVAILABLE,
        title: 'Product In Stock',
        message: 'Product is now available!',
        metadata: { price: 499.99 },
      };

      const createdAlert = createMockAlert({
        ...input,
        id: 'alert-1',
      });

      mockAlertRepository.create.mockResolvedValue(createdAlert);

      const result = await service.createAlert(input);

      expect(mockAlertRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          skuId: input.skuId,
          type: input.type,
          title: input.title,
          message: input.message,
        }),
      );
      expect(result.type).toBe(AlertType.STOCK_AVAILABLE);
      expect(mockMetricsCollector.incrementCounter).toHaveBeenCalled();
    });

    it('should use default metadata if not provided', async () => {
      const input = {
        skuId: 'sku-123',
        type: AlertType.PRICE_CHANGE,
        title: 'Price Changed',
        message: 'Price has changed!',
      };

      const createdAlert = createMockAlert(input);
      mockAlertRepository.create.mockResolvedValue(createdAlert);

      await service.createAlert(input);

      expect(mockAlertRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {},
        }),
      );
    });
  });

  describe('getById', () => {
    it('should return alert when found', async () => {
      const alert = createMockAlert();
      mockAlertRepository.findById.mockResolvedValue(alert);

      const result = await service.getById(alert.id);

      expect(result).toEqual(alert);
    });

    it('should return null when not found', async () => {
      mockAlertRepository.findById.mockResolvedValue(null);

      const result = await service.getById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getAll', () => {
    it('should return paginated alerts', async () => {
      const alerts = [createMockAlert(), createMockAlert()];
      mockAlertRepository.findAll.mockResolvedValue({
        data: alerts,
        pagination: { page: 1, limit: 10, total: 50, totalPages: 5 },
      });

      const result = await service.getAll({ page: 1, limit: 10 });

      expect(result.data).toEqual(alerts);
      expect(result.pagination.total).toBe(50);
    });
  });

  describe('getByFilter', () => {
    it('should filter by skuId', async () => {
      const alerts = [createMockAlert({ skuId: 'sku-123' })];
      mockAlertRepository.findWhere.mockResolvedValue({
        data: alerts,
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });

      const result = await service.getByFilter({ skuId: 'sku-123' });

      expect(mockAlertRepository.findWhere).toHaveBeenCalledWith(
        expect.objectContaining({ sku_id: 'sku-123' }),
        undefined,
      );
      expect(result.data).toEqual(alerts);
    });

    it('should filter by type', async () => {
      mockAlertRepository.findWhere.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });

      await service.getByFilter({ type: AlertType.STOCK_AVAILABLE });

      expect(mockAlertRepository.findWhere).toHaveBeenCalledWith(
        expect.objectContaining({ type: AlertType.STOCK_AVAILABLE }),
        undefined,
      );
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      mockAlertRepository.findByDateRange.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });

      await service.getByFilter({ startDate, endDate });

      expect(mockAlertRepository.findByDateRange).toHaveBeenCalledWith(
        startDate,
        endDate,
        undefined,
      );
    });
  });

  describe('getUnacknowledged', () => {
    it('should return unacknowledged alerts', async () => {
      const alerts = [
        createMockAlert({ acknowledgedAt: null }),
        createMockAlert({ acknowledgedAt: null }),
      ];
      mockAlertRepository.findUnacknowledged.mockResolvedValue(alerts);

      const result = await service.getUnacknowledged();

      expect(result).toEqual(alerts);
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge alert', async () => {
      const alert = createMockAlert();
      const acknowledgedAlert = { ...alert, acknowledgedAt: new Date() };
      mockAlertRepository.acknowledge.mockResolvedValue(acknowledgedAlert);

      const result = await service.acknowledge(alert.id);

      expect(mockAlertRepository.acknowledge).toHaveBeenCalledWith(alert.id, 'system');
      expect(result.acknowledgedAt).toBeDefined();
    });

    it('should throw if alert not found', async () => {
      mockAlertRepository.acknowledge.mockResolvedValue(null);

      await expect(service.acknowledge('non-existent')).rejects.toThrow('Alert not found');
    });
  });

  describe('acknowledgeAll', () => {
    it('should acknowledge all alerts', async () => {
      mockAlertRepository.acknowledgeAll.mockResolvedValue(5);

      const result = await service.acknowledgeAll();

      expect(mockAlertRepository.acknowledgeAll).toHaveBeenCalledWith(undefined);
      expect(result).toBe(5);
    });

    it('should acknowledge all alerts for a specific SKU', async () => {
      mockAlertRepository.acknowledgeAll.mockResolvedValue(3);

      const result = await service.acknowledgeAll('sku-123');

      expect(mockAlertRepository.acknowledgeAll).toHaveBeenCalledWith('sku-123');
      expect(result).toBe(3);
    });
  });

  describe('getRecentBySKU', () => {
    it('should return recent alerts for SKU', async () => {
      const alerts = [createMockAlert(), createMockAlert()];
      mockAlertRepository.findBySKU.mockResolvedValue(alerts);

      const result = await service.getRecentBySKU('sku-123');

      expect(mockAlertRepository.findBySKU).toHaveBeenCalledWith('sku-123', 20);
      expect(result).toEqual(alerts);
    });

    it('should support custom limit', async () => {
      mockAlertRepository.findBySKU.mockResolvedValue([]);

      await service.getRecentBySKU('sku-123', 5);

      expect(mockAlertRepository.findBySKU).toHaveBeenCalledWith('sku-123', 5);
    });
  });

  describe('getAlertCounts', () => {
    it('should return alert counts', async () => {
      // Mock findWhere for pending count and type counts
      mockAlertRepository.findWhere.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 1, total: 5, totalPages: 1 },
      });

      // Mock findAll for total count
      mockAlertRepository.findAll.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 1, total: 20, totalPages: 20 },
      });

      const result = await service.getAlertCounts();

      expect(result.total).toBe(20);
      expect(result.pending).toBe(5);
      expect(result.acknowledged).toBe(15);
      expect(result.byType).toBeDefined();
    });
  });
});
