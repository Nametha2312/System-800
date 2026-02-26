import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSKU } from '../fixtures';
import { StockStatus, MonitoringStatus, RetailerType } from '../../types/index.js';

// Mock dependencies
const mockSKURepository = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  findByRetailerAndProductId: vi.fn(),
  findByRetailer: vi.fn(),
  findActiveForMonitoring: vi.fn(),
  findAll: vi.fn(),
  getStatistics: vi.fn(),
  updateStockStatus: vi.fn(),
};

const mockAdapterFactory = {
  getAdapter: vi.fn(),
};

const mockMetricsCollector = {
  incrementCounter: vi.fn(),
  setGauge: vi.fn(),
  recordLatency: vi.fn(),
};

// Mock repository
vi.mock('../../persistence/repositories/sku.repository.js', () => ({
  getSKURepository: () => mockSKURepository,
}));

// Mock adapter factory
vi.mock('../../adapters/factory.js', () => ({
  getAdapterFactory: () => mockAdapterFactory,
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
    ACTIVE_SKUS: 'active_skus',
    PAUSED_SKUS: 'paused_skus',
  },
}));

// Import service after mocks
import { SKUServiceImpl } from '../../services/sku.service.js';

describe('SKUService', () => {
  let service: InstanceType<typeof SKUServiceImpl>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SKUServiceImpl(mockSKURepository as any, mockAdapterFactory as any);
    
    // Default mock for getStatistics used by internal methods
    mockSKURepository.getStatistics.mockResolvedValue({
      total: 10,
      active: 5,
      paused: 2,
      stopped: 3,
      inStock: 4,
      outOfStock: 6,
      withAutoCheckout: 2,
    });
  });

  describe('create', () => {
    it('should create a new SKU', async () => {
      const input = {
        retailer: RetailerType.AMAZON,
        productId: 'B09BNFWW5V',
        productUrl: 'https://www.amazon.com/dp/B09BNFWW5V',
        productName: 'Test Product',
        targetPrice: 499.99,
        autoCheckoutEnabled: false,
        pollingIntervalMs: 60000,
      };

      const createdSKU = createMockSKU(input);

      mockSKURepository.findByRetailerAndProductId.mockResolvedValue(null);
      mockAdapterFactory.getAdapter.mockReturnValue({
        validateUrl: vi.fn().mockReturnValue(true),
      });
      mockSKURepository.create.mockResolvedValue(createdSKU);

      const result = await service.create(input);

      expect(mockSKURepository.findByRetailerAndProductId).toHaveBeenCalledWith(
        input.retailer,
        input.productId,
      );
      expect(mockSKURepository.create).toHaveBeenCalled();
      expect(result.retailer).toBe(input.retailer);
    });

    it('should throw if SKU already exists', async () => {
      const existingSKU = createMockSKU();
      mockSKURepository.findByRetailerAndProductId.mockResolvedValue(existingSKU);

      await expect(
        service.create({
          retailer: existingSKU.retailer,
          productId: existingSKU.productId,
          productUrl: existingSKU.productUrl,
          productName: 'New Product',
          autoCheckoutEnabled: false,
          pollingIntervalMs: 60000,
        }),
      ).rejects.toThrow('SKU already exists');
    });

    it('should validate URL with adapter', async () => {
      mockSKURepository.findByRetailerAndProductId.mockResolvedValue(null);
      mockAdapterFactory.getAdapter.mockReturnValue({
        validateUrl: vi.fn().mockReturnValue(false),
      });

      await expect(
        service.create({
          retailer: RetailerType.AMAZON,
          productId: 'B09BNFWW5V',
          productUrl: 'http://invalid-url.com',
          productName: 'Test Product',
          autoCheckoutEnabled: false,
          pollingIntervalMs: 60000,
        }),
      ).rejects.toThrow('Invalid URL');
    });
  });

  describe('getById', () => {
    it('should return SKU when found', async () => {
      const sku = createMockSKU();
      mockSKURepository.findById.mockResolvedValue(sku);

      const result = await service.getById(sku.id);

      expect(mockSKURepository.findById).toHaveBeenCalledWith(sku.id);
      expect(result).toEqual(sku);
    });

    it('should return null when SKU not found', async () => {
      mockSKURepository.findById.mockResolvedValue(null);

      const result = await service.getById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('getByRetailer', () => {
    it('should return SKUs for retailer', async () => {
      const skus = [
        createMockSKU({ retailer: RetailerType.AMAZON }),
        createMockSKU({ retailer: RetailerType.AMAZON }),
      ];
      mockSKURepository.findByRetailer.mockResolvedValue(skus);

      const result = await service.getByRetailer(RetailerType.AMAZON);

      expect(mockSKURepository.findByRetailer).toHaveBeenCalledWith(RetailerType.AMAZON);
      expect(result).toEqual(skus);
    });
  });

  describe('update', () => {
    it('should update SKU fields', async () => {
      const sku = createMockSKU();
      const updates = { productName: 'Updated Name', targetPrice: 399.99 };
      const updatedSKU = { ...sku, ...updates };

      mockSKURepository.findById.mockResolvedValue(sku);
      mockSKURepository.update.mockResolvedValue(updatedSKU);

      const result = await service.update(sku.id, updates);

      expect(mockSKURepository.update).toHaveBeenCalledWith(
        sku.id,
        expect.objectContaining({
          productName: 'Updated Name',
          targetPrice: 399.99,
        }),
      );
      expect(result.productName).toBe('Updated Name');
    });

    it('should throw for non-existent SKU', async () => {
      mockSKURepository.findById.mockResolvedValue(null);

      await expect(
        service.update('non-existent', { productName: 'Test' }),
      ).rejects.toThrow('SKU not found');
    });
  });

  describe('delete', () => {
    it('should soft delete existing SKU', async () => {
      mockSKURepository.softDelete.mockResolvedValue(true);

      const result = await service.delete('sku-123');

      expect(mockSKURepository.softDelete).toHaveBeenCalledWith('sku-123');
      expect(result).toBe(true);
    });

    it('should return false for non-existent SKU', async () => {
      mockSKURepository.softDelete.mockResolvedValue(false);

      const result = await service.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('startMonitoring', () => {
    it('should start monitoring for SKU', async () => {
      const sku = createMockSKU({ monitoringStatus: MonitoringStatus.STOPPED });
      const activeSKU = { ...sku, monitoringStatus: MonitoringStatus.ACTIVE };

      mockSKURepository.update.mockResolvedValue(activeSKU);

      const result = await service.startMonitoring(sku.id);

      expect(mockSKURepository.update).toHaveBeenCalledWith(
        sku.id,
        expect.objectContaining({
          monitoringStatus: MonitoringStatus.ACTIVE,
          consecutiveErrors: 0,
        }),
      );
      expect(result.monitoringStatus).toBe(MonitoringStatus.ACTIVE);
    });

    it('should throw if SKU not found', async () => {
      mockSKURepository.update.mockResolvedValue(null);

      await expect(service.startMonitoring('non-existent')).rejects.toThrow('SKU not found');
    });
  });

  describe('pauseMonitoring', () => {
    it('should pause monitoring for SKU', async () => {
      const sku = createMockSKU({ monitoringStatus: MonitoringStatus.ACTIVE });
      const pausedSKU = { ...sku, monitoringStatus: MonitoringStatus.PAUSED };

      mockSKURepository.update.mockResolvedValue(pausedSKU);

      const result = await service.pauseMonitoring(sku.id);

      expect(mockSKURepository.update).toHaveBeenCalledWith(
        sku.id,
        expect.objectContaining({ monitoringStatus: MonitoringStatus.PAUSED }),
      );
      expect(result.monitoringStatus).toBe(MonitoringStatus.PAUSED);
    });
  });

  describe('stopMonitoring', () => {
    it('should stop monitoring for SKU', async () => {
      const sku = createMockSKU({ monitoringStatus: MonitoringStatus.ACTIVE });
      const stoppedSKU = { ...sku, monitoringStatus: MonitoringStatus.STOPPED };

      mockSKURepository.update.mockResolvedValue(stoppedSKU);

      const result = await service.stopMonitoring(sku.id);

      expect(mockSKURepository.update).toHaveBeenCalledWith(
        sku.id,
        expect.objectContaining({ monitoringStatus: MonitoringStatus.STOPPED }),
      );
      expect(result.monitoringStatus).toBe(MonitoringStatus.STOPPED);
    });
  });

  describe('getActiveForMonitoring', () => {
    it('should return SKUs due for monitoring', async () => {
      const skus = [createMockSKU(), createMockSKU()];
      mockSKURepository.findActiveForMonitoring.mockResolvedValue(skus);

      const result = await service.getActiveForMonitoring();

      expect(mockSKURepository.findActiveForMonitoring).toHaveBeenCalled();
      expect(result).toEqual(skus);
    });
  });

  describe('updateStockStatus', () => {
    it('should update stock status and price', async () => {
      const sku = createMockSKU();
      const updatedSKU = {
        ...sku,
        currentStockStatus: StockStatus.IN_STOCK,
        currentPrice: 499.99,
      };

      mockSKURepository.updateStockStatus.mockResolvedValue(updatedSKU);

      const result = await service.updateStockStatus(sku.id, StockStatus.IN_STOCK, 499.99);

      expect(mockSKURepository.updateStockStatus).toHaveBeenCalledWith(
        sku.id,
        StockStatus.IN_STOCK,
        499.99,
      );
      expect(result.currentStockStatus).toBe(StockStatus.IN_STOCK);
    });

    it('should throw if SKU not found', async () => {
      mockSKURepository.updateStockStatus.mockResolvedValue(null);

      await expect(
        service.updateStockStatus('non-existent', StockStatus.IN_STOCK, 499.99),
      ).rejects.toThrow('SKU not found');
    });
  });

  describe('enableAutoCheckout', () => {
    it('should enable auto-checkout for SKU', async () => {
      const sku = createMockSKU({ autoCheckoutEnabled: false });
      const updatedSKU = { ...sku, autoCheckoutEnabled: true };

      mockSKURepository.update.mockResolvedValue(updatedSKU);

      const result = await service.enableAutoCheckout(sku.id);

      expect(mockSKURepository.update).toHaveBeenCalledWith(
        sku.id,
        expect.objectContaining({ autoCheckoutEnabled: true }),
      );
      expect(result.autoCheckoutEnabled).toBe(true);
    });
  });

  describe('disableAutoCheckout', () => {
    it('should disable auto-checkout for SKU', async () => {
      const sku = createMockSKU({ autoCheckoutEnabled: true });
      const updatedSKU = { ...sku, autoCheckoutEnabled: false };

      mockSKURepository.update.mockResolvedValue(updatedSKU);

      const result = await service.disableAutoCheckout(sku.id);

      expect(mockSKURepository.update).toHaveBeenCalledWith(
        sku.id,
        expect.objectContaining({ autoCheckoutEnabled: false }),
      );
      expect(result.autoCheckoutEnabled).toBe(false);
    });
  });

  describe('getStatistics', () => {
    it('should return SKU statistics', async () => {
      const stats = {
        total: 10,
        active: 5,
        paused: 2,
        stopped: 3,
        inStock: 4,
        outOfStock: 6,
        withAutoCheckout: 2,
      };
      mockSKURepository.getStatistics.mockResolvedValue(stats);

      const result = await service.getStatistics();

      expect(result).toEqual(stats);
    });
  });

  describe('getAll', () => {
    it('should return paginated SKUs', async () => {
      const skus = [createMockSKU(), createMockSKU()];
      const paginatedResponse = {
        data: skus,
        total: 50,
        page: 1,
        limit: 10,
        totalPages: 5,
      };
      mockSKURepository.findAll.mockResolvedValue(paginatedResponse);

      const result = await service.getAll({ page: 1, limit: 10 });

      expect(mockSKURepository.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
      expect(result.data).toEqual(skus);
      expect(result.total).toBe(50);
    });
  });
});
