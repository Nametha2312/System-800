import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSKU, createMockMonitoringEvent } from '../fixtures';
import { StockStatus, RetailerType } from '../../types/index.js';

// Mock dependencies
const mockSKUService = {
  getById: vi.fn(),
  updateStockStatus: vi.fn(),
  pauseMonitoring: vi.fn(),
};

const mockAlertService = {
  createAlert: vi.fn(),
};

const mockAdapterFactory = {
  getAdapter: vi.fn(),
};

const mockEventRepository = {
  create: vi.fn(),
  findBySKU: vi.fn(),
};

const mockMetricsCollector = {
  incrementCounter: vi.fn(),
  recordLatency: vi.fn(),
  setGauge: vi.fn(),
};

// Mock the services
vi.mock('../../services/sku.service.js', () => ({
  getSKUService: () => mockSKUService,
}));

vi.mock('../../services/alert.service.js', () => ({
  getAlertService: () => mockAlertService,
}));

vi.mock('../../adapters/factory.js', () => ({
  getAdapterFactory: () => mockAdapterFactory,
}));

vi.mock('../../persistence/repositories/monitoring-event.repository.js', () => ({
  getMonitoringEventRepository: () => mockEventRepository,
}));

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
  getMetricsCollector: () => mockMetricsCollector,
  MetricNames: {
    MONITORING_CHECKS: 'monitoring_checks',
    MONITORING_ERRORS: 'monitoring_errors',
    IN_STOCK_DETECTIONS: 'in_stock_detections',
    ADAPTER_LATENCY: 'adapter_latency',
    ACTIVE_SKUS: 'active_skus',
  },
}));

// Import service after mocks
import { MonitoringServiceImpl, MonitoringResult } from '../../services/monitoring.service.js';

describe('MonitoringService', () => {
  let service: InstanceType<typeof MonitoringServiceImpl>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MonitoringServiceImpl(
      mockSKUService as any,
      mockAlertService as any,
      mockAdapterFactory as any,
      mockEventRepository as any,
    );
  });

  describe('checkProduct', () => {
    it('should check product and return result', async () => {
      const sku = createMockSKU({
        currentStockStatus: StockStatus.OUT_OF_STOCK,
        currentPrice: 599.99,
      });

      const mockAdapter = {
        checkProduct: vi.fn().mockResolvedValue({
          success: true,
          productInfo: {
            stockStatus: StockStatus.IN_STOCK,
            price: 499.99,
            title: 'Test Product',
          },
        }),
      };

      mockAdapterFactory.getAdapter.mockReturnValue(mockAdapter);

      const result = await service.checkProduct(sku);

      expect(result.skuId).toBe(sku.id);
      expect(result.currentStatus).toBe(StockStatus.IN_STOCK);
      expect(result.currentPrice).toBe(499.99);
      expect(result.statusChanged).toBe(true);
      expect(result.priceChanged).toBe(true);
      expect(mockMetricsCollector.incrementCounter).toHaveBeenCalled();
    });

    it('should handle adapter errors', async () => {
      const sku = createMockSKU();

      const mockAdapter = {
        checkProduct: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      mockAdapterFactory.getAdapter.mockReturnValue(mockAdapter);

      const result = await service.checkProduct(sku);

      expect(result.error).toBe('Network error');
      expect(mockMetricsCollector.incrementCounter).toHaveBeenCalled();
    });

    it('should handle failed product check', async () => {
      const sku = createMockSKU();

      const mockAdapter = {
        checkProduct: vi.fn().mockResolvedValue({
          success: false,
          error: { message: 'Product not found' },
        }),
      };

      mockAdapterFactory.getAdapter.mockReturnValue(mockAdapter);

      const result = await service.checkProduct(sku);

      expect(result.error).toBe('Product not found');
    });

    it('should detect price meets target', async () => {
      const sku = createMockSKU({
        targetPrice: 500,
        currentPrice: 600,
        currentStockStatus: StockStatus.IN_STOCK,
      });

      const mockAdapter = {
        checkProduct: vi.fn().mockResolvedValue({
          success: true,
          productInfo: {
            stockStatus: StockStatus.IN_STOCK,
            price: 450,
            title: 'Test Product',
          },
        }),
      };

      mockAdapterFactory.getAdapter.mockReturnValue(mockAdapter);

      const result = await service.checkProduct(sku);

      expect(result.meetsTargetPrice).toBe(true);
    });
  });

  describe('processCheckResult', () => {
    it('should update SKU and create event for successful check', async () => {
      const sku = createMockSKU();
      const result: MonitoringResult = {
        skuId: sku.id,
        productId: sku.productId,
        retailer: sku.retailer,
        previousStatus: StockStatus.UNKNOWN,
        currentStatus: StockStatus.IN_STOCK,
        previousPrice: null,
        currentPrice: 499.99,
        statusChanged: true,
        priceChanged: false,
        meetsTargetPrice: false,
        executionTimeMs: 1000,
        error: null,
      };

      mockSKUService.updateStockStatus.mockResolvedValue(sku);
      mockEventRepository.create.mockResolvedValue(createMockMonitoringEvent());

      await service.processCheckResult(result);

      expect(mockSKUService.updateStockStatus).toHaveBeenCalledWith(
        result.skuId,
        result.currentStatus,
        result.currentPrice,
      );
      expect(mockEventRepository.create).toHaveBeenCalled();
    });

    it('should record failure and skip updates on error', async () => {
      const sku = createMockSKU();
      const result: MonitoringResult = {
        skuId: sku.id,
        productId: sku.productId,
        retailer: sku.retailer,
        previousStatus: StockStatus.UNKNOWN,
        currentStatus: StockStatus.UNKNOWN,
        previousPrice: null,
        currentPrice: null,
        statusChanged: false,
        priceChanged: false,
        meetsTargetPrice: false,
        executionTimeMs: 1000,
        error: 'Network error',
      };

      mockSKUService.getById.mockResolvedValue(sku);
      mockEventRepository.create.mockResolvedValue(createMockMonitoringEvent());

      await service.processCheckResult(result);

      // Should call recordCheckFailure logic, not updateStockStatus
      expect(mockSKUService.updateStockStatus).not.toHaveBeenCalled();
    });

    it('should create stock available alert on status change to in stock', async () => {
      const sku = createMockSKU({ productName: 'Test Product' });
      const result: MonitoringResult = {
        skuId: sku.id,
        productId: sku.productId,
        retailer: sku.retailer,
        previousStatus: StockStatus.OUT_OF_STOCK,
        currentStatus: StockStatus.IN_STOCK,
        previousPrice: null,
        currentPrice: 499.99,
        statusChanged: true,
        priceChanged: false,
        meetsTargetPrice: false,
        executionTimeMs: 1000,
        error: null,
      };

      mockSKUService.updateStockStatus.mockResolvedValue(sku);
      mockEventRepository.create.mockResolvedValue(createMockMonitoringEvent());

      await service.processCheckResult(result);

      expect(mockAlertService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          skuId: sku.id,
          type: 'STOCK_AVAILABLE',
        }),
      );
    });
  });

  describe('recordCheckFailure', () => {
    it('should record error in monitoring event', async () => {
      const sku = createMockSKU({ consecutiveErrors: 0 });
      mockSKUService.getById.mockResolvedValue(sku);
      mockEventRepository.create.mockResolvedValue(createMockMonitoringEvent());

      await service.recordCheckFailure(sku.id, new Error('Network error'));

      expect(mockEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          skuId: sku.id,
          eventType: 'ERROR',
          errorMessage: 'Network error',
        }),
      );
    });

    it('should pause monitoring after max errors', async () => {
      const sku = createMockSKU({ consecutiveErrors: 4 }); // Will be 5 after increment
      mockSKUService.getById.mockResolvedValue(sku);
      mockEventRepository.create.mockResolvedValue(createMockMonitoringEvent());

      await service.recordCheckFailure(sku.id, new Error('Error'));

      expect(mockSKUService.pauseMonitoring).toHaveBeenCalledWith(sku.id);
      expect(mockAlertService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MONITORING_ERROR',
        }),
      );
    });

    it('should do nothing if SKU not found', async () => {
      mockSKUService.getById.mockResolvedValue(null);

      await service.recordCheckFailure('non-existent', new Error('Error'));

      expect(mockEventRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getRecentEvents', () => {
    it('should return monitoring events for SKU', async () => {
      const events = [
        createMockMonitoringEvent({ skuId: 'sku-123' }),
        createMockMonitoringEvent({ skuId: 'sku-123' }),
      ];
      mockEventRepository.findBySKU.mockResolvedValue(events);

      const result = await service.getRecentEvents('sku-123');

      expect(mockEventRepository.findBySKU).toHaveBeenCalledWith('sku-123', 50);
      expect(result).toEqual(events);
    });

    it('should support custom limit', async () => {
      mockEventRepository.findBySKU.mockResolvedValue([]);

      await service.getRecentEvents('sku-123', 10);

      expect(mockEventRepository.findBySKU).toHaveBeenCalledWith('sku-123', 10);
    });
  });

  describe('getStockChanges', () => {
    it('should return only stock change events', async () => {
      const events = [
        createMockMonitoringEvent({ eventType: 'STOCK_CHANGE' }),
        createMockMonitoringEvent({ eventType: 'CHECK' }),
        createMockMonitoringEvent({ eventType: 'STOCK_CHANGE' }),
      ];
      mockEventRepository.findBySKU.mockResolvedValue(events);

      const result = await service.getStockChanges('sku-123');

      expect(result).toHaveLength(2);
      expect(result.every(e => e.eventType === 'STOCK_CHANGE')).toBe(true);
    });
  });

  describe('shouldTriggerCheckout', () => {
    it('should trigger checkout for stock becoming available', () => {
      const result: MonitoringResult = {
        skuId: 'sku-1',
        productId: 'prod-1',
        retailer: RetailerType.AMAZON,
        previousStatus: StockStatus.OUT_OF_STOCK,
        currentStatus: StockStatus.IN_STOCK,
        previousPrice: null,
        currentPrice: 499.99,
        statusChanged: true,
        priceChanged: false,
        meetsTargetPrice: false,
        executionTimeMs: 1000,
        error: null,
      };

      expect(service.shouldTriggerCheckout(result)).toBe(true);
    });

    it('should trigger checkout when meets target price', () => {
      const result: MonitoringResult = {
        skuId: 'sku-1',
        productId: 'prod-1',
        retailer: RetailerType.AMAZON,
        previousStatus: StockStatus.IN_STOCK,
        currentStatus: StockStatus.IN_STOCK,
        previousPrice: 600,
        currentPrice: 450,
        statusChanged: false,
        priceChanged: true,
        meetsTargetPrice: true,
        executionTimeMs: 1000,
        error: null,
      };

      expect(service.shouldTriggerCheckout(result)).toBe(true);
    });

    it('should not trigger checkout on error', () => {
      const result: MonitoringResult = {
        skuId: 'sku-1',
        productId: 'prod-1',
        retailer: RetailerType.AMAZON,
        previousStatus: StockStatus.OUT_OF_STOCK,
        currentStatus: StockStatus.IN_STOCK,
        previousPrice: null,
        currentPrice: 499.99,
        statusChanged: true,
        priceChanged: false,
        meetsTargetPrice: false,
        executionTimeMs: 1000,
        error: 'Some error',
      };

      expect(service.shouldTriggerCheckout(result)).toBe(false);
    });

    it('should not trigger checkout if out of stock', () => {
      const result: MonitoringResult = {
        skuId: 'sku-1',
        productId: 'prod-1',
        retailer: RetailerType.AMAZON,
        previousStatus: StockStatus.IN_STOCK,
        currentStatus: StockStatus.OUT_OF_STOCK,
        previousPrice: 499.99,
        currentPrice: 499.99,
        statusChanged: true,
        priceChanged: false,
        meetsTargetPrice: false,
        executionTimeMs: 1000,
        error: null,
      };

      expect(service.shouldTriggerCheckout(result)).toBe(false);
    });

    it('should not trigger checkout if no changes', () => {
      const result: MonitoringResult = {
        skuId: 'sku-1',
        productId: 'prod-1',
        retailer: RetailerType.AMAZON,
        previousStatus: StockStatus.IN_STOCK,
        currentStatus: StockStatus.IN_STOCK,
        previousPrice: 499.99,
        currentPrice: 499.99,
        statusChanged: false,
        priceChanged: false,
        meetsTargetPrice: false,
        executionTimeMs: 1000,
        error: null,
      };

      expect(service.shouldTriggerCheckout(result)).toBe(false);
    });
  });
});
