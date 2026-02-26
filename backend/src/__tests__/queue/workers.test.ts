import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSKU, createMockProductCheckResult } from '../fixtures';
import { StockStatus, AlertType, CheckoutStatus } from '../../types';

// Mock all dependencies
const mockSKUService = {
  findById: vi.fn(),
  updateLastChecked: vi.fn(),
  handleCheckError: vi.fn(),
  resetErrors: vi.fn(),
};

const mockMonitoringService = {
  checkProduct: vi.fn(),
  processCheckResult: vi.fn(),
  processCheckError: vi.fn(),
  shouldTriggerAlert: vi.fn(),
  shouldTriggerAutoCheckout: vi.fn(),
};

const mockAlertService = {
  create: vi.fn(),
  createStockAlert: vi.fn(),
  createPriceDropAlert: vi.fn(),
};

const mockCheckoutService = {
  initiateCheckout: vi.fn(),
  updateStatus: vi.fn(),
};

const mockQueueManager = {
  addToCheckoutQueue: vi.fn(),
  addToAlertQueue: vi.fn(),
  addToDeadLetterQueue: vi.fn(),
};

vi.mock('../../services', () => ({
  getSKUService: () => mockSKUService,
  getMonitoringService: () => mockMonitoringService,
  getAlertService: () => mockAlertService,
  getCheckoutService: () => mockCheckoutService,
}));

vi.mock('../../queue', () => ({
  getQueueManager: () => mockQueueManager,
}));

// Simulate worker job processors
async function processMonitoringJob(job: { data: { skuId: string } }) {
  const { skuId } = job.data;
  const startTime = Date.now();

  try {
    const sku = await mockSKUService.findById(skuId);
    if (!sku) {
      throw new Error('SKU not found');
    }

    const result = await mockMonitoringService.checkProduct(skuId);
    const responseTime = Date.now() - startTime;

    const { stockChanged, priceChanged, previousPrice } =
      await mockMonitoringService.processCheckResult(skuId, result, responseTime);

    // Check if we should trigger alerts
    if (stockChanged && result.stockStatus === StockStatus.IN_STOCK) {
      await mockAlertService.createStockAlert(sku, sku.created_by, result.price);
    }

    if (priceChanged && previousPrice && result.price < previousPrice) {
      await mockAlertService.createPriceDropAlert(
        sku,
        sku.created_by,
        previousPrice,
        result.price,
      );
    }

    // Check if we should trigger auto-checkout
    if (
      mockMonitoringService.shouldTriggerAutoCheckout(
        sku,
        result.stockStatus,
        result.price,
      )
    ) {
      await mockQueueManager.addToCheckoutQueue({
        skuId: sku.id,
        userId: sku.created_by,
        price: result.price,
      });
    }

    return { success: true, result };
  } catch (error) {
    await mockMonitoringService.processCheckError(
      skuId,
      error as Error,
      Date.now() - startTime,
    );
    throw error;
  }
}

async function processCheckoutJob(job: {
  data: { skuId: string; userId: string; attemptId: string };
}) {
  const { skuId, userId, attemptId } = job.data;

  try {
    const result = await mockCheckoutService.initiateCheckout(
      skuId,
      userId,
      attemptId,
    );
    return result;
  } catch (error) {
    await mockCheckoutService.updateStatus(attemptId, CheckoutStatus.FAILED, {
      error_message: (error as Error).message,
    });
    throw error;
  }
}

async function processAlertJob(job: {
  data: {
    type: AlertType;
    message: string;
    skuId: string;
    userId: string;
    metadata?: Record<string, unknown>;
  };
}) {
  const { type, message, skuId, userId, metadata } = job.data;

  await mockAlertService.create({
    type,
    message,
    sku_id: skuId,
    user_id: userId,
    metadata,
  });

  return { success: true };
}

async function processDeadLetterJob(job: {
  data: {
    originalQueue: string;
    originalJob: unknown;
    error: string;
    failedAt: string;
  };
}) {
  // Just log for now - in production this would notify admins
  console.log('Dead letter job:', job.data);
  return { processed: true };
}

describe('Queue Workers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Monitoring Worker', () => {
    it('should process monitoring job successfully', async () => {
      const sku = createMockSKU({
        last_stock_status: StockStatus.OUT_OF_STOCK,
      });
      const result = createMockProductCheckResult({
        stockStatus: StockStatus.IN_STOCK,
        price: 499.99,
      });

      mockSKUService.findById.mockResolvedValue(sku);
      mockMonitoringService.checkProduct.mockResolvedValue(result);
      mockMonitoringService.processCheckResult.mockResolvedValue({
        stockChanged: true,
        priceChanged: false,
      });

      const jobResult = await processMonitoringJob({ data: { skuId: sku.id } });

      expect(jobResult.success).toBe(true);
      expect(mockMonitoringService.checkProduct).toHaveBeenCalledWith(sku.id);
      expect(mockMonitoringService.processCheckResult).toHaveBeenCalled();
    });

    it('should create stock alert when product becomes available', async () => {
      const sku = createMockSKU({
        last_stock_status: StockStatus.OUT_OF_STOCK,
      });
      const result = createMockProductCheckResult({
        stockStatus: StockStatus.IN_STOCK,
        price: 499.99,
      });

      mockSKUService.findById.mockResolvedValue(sku);
      mockMonitoringService.checkProduct.mockResolvedValue(result);
      mockMonitoringService.processCheckResult.mockResolvedValue({
        stockChanged: true,
        priceChanged: false,
      });

      await processMonitoringJob({ data: { skuId: sku.id } });

      expect(mockAlertService.createStockAlert).toHaveBeenCalledWith(
        sku,
        sku.created_by,
        499.99,
      );
    });

    it('should create price drop alert', async () => {
      const sku = createMockSKU({ last_price: 599.99 });
      const result = createMockProductCheckResult({ price: 499.99 });

      mockSKUService.findById.mockResolvedValue(sku);
      mockMonitoringService.checkProduct.mockResolvedValue(result);
      mockMonitoringService.processCheckResult.mockResolvedValue({
        stockChanged: false,
        priceChanged: true,
        previousPrice: 599.99,
      });

      await processMonitoringJob({ data: { skuId: sku.id } });

      expect(mockAlertService.createPriceDropAlert).toHaveBeenCalledWith(
        sku,
        sku.created_by,
        599.99,
        499.99,
      );
    });

    it('should trigger auto-checkout when conditions are met', async () => {
      const sku = createMockSKU({ auto_checkout: true, target_price: 500 });
      const result = createMockProductCheckResult({
        stockStatus: StockStatus.IN_STOCK,
        price: 499.99,
      });

      mockSKUService.findById.mockResolvedValue(sku);
      mockMonitoringService.checkProduct.mockResolvedValue(result);
      mockMonitoringService.processCheckResult.mockResolvedValue({
        stockChanged: true,
        priceChanged: false,
      });
      mockMonitoringService.shouldTriggerAutoCheckout.mockReturnValue(true);

      await processMonitoringJob({ data: { skuId: sku.id } });

      expect(mockQueueManager.addToCheckoutQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          skuId: sku.id,
          userId: sku.created_by,
          price: 499.99,
        }),
      );
    });

    it('should handle errors and update SKU error count', async () => {
      const sku = createMockSKU();
      mockSKUService.findById.mockResolvedValue(sku);
      mockMonitoringService.checkProduct.mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        processMonitoringJob({ data: { skuId: sku.id } }),
      ).rejects.toThrow('Network error');

      expect(mockMonitoringService.processCheckError).toHaveBeenCalledWith(
        sku.id,
        expect.any(Error),
        expect.any(Number),
      );
    });

    it('should throw error for non-existent SKU', async () => {
      mockSKUService.findById.mockResolvedValue(null);

      await expect(
        processMonitoringJob({ data: { skuId: 'non-existent' } }),
      ).rejects.toThrow('SKU not found');
    });
  });

  describe('Checkout Worker', () => {
    it('should process checkout job successfully', async () => {
      mockCheckoutService.initiateCheckout.mockResolvedValue({
        status: CheckoutStatus.SUCCEEDED,
        orderId: 'order-123',
      });

      const result = await processCheckoutJob({
        data: {
          skuId: 'sku-123',
          userId: 'user-123',
          attemptId: 'attempt-123',
        },
      });

      expect(result.status).toBe(CheckoutStatus.SUCCEEDED);
      expect(mockCheckoutService.initiateCheckout).toHaveBeenCalledWith(
        'sku-123',
        'user-123',
        'attempt-123',
      );
    });

    it('should update status on failure', async () => {
      mockCheckoutService.initiateCheckout.mockRejectedValue(
        new Error('Payment declined'),
      );

      await expect(
        processCheckoutJob({
          data: {
            skuId: 'sku-123',
            userId: 'user-123',
            attemptId: 'attempt-123',
          },
        }),
      ).rejects.toThrow('Payment declined');

      expect(mockCheckoutService.updateStatus).toHaveBeenCalledWith(
        'attempt-123',
        CheckoutStatus.FAILED,
        expect.objectContaining({ error_message: 'Payment declined' }),
      );
    });
  });

  describe('Alert Worker', () => {
    it('should process alert job', async () => {
      const result = await processAlertJob({
        data: {
          type: AlertType.STOCK_AVAILABLE,
          message: 'Product is in stock!',
          skuId: 'sku-123',
          userId: 'user-123',
          metadata: { price: 499.99 },
        },
      });

      expect(result.success).toBe(true);
      expect(mockAlertService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AlertType.STOCK_AVAILABLE,
          message: 'Product is in stock!',
          sku_id: 'sku-123',
        }),
      );
    });
  });

  describe('Dead Letter Worker', () => {
    it('should process dead letter job', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      const result = await processDeadLetterJob({
        data: {
          originalQueue: 'monitoring:amazon',
          originalJob: { skuId: 'sku-123' },
          error: 'Max retries exceeded',
          failedAt: new Date().toISOString(),
        },
      });

      expect(result.processed).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
