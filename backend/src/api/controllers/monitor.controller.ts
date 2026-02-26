import { Response } from 'express';
import { z } from 'zod';
import { getSKUService } from '../../services/sku.service.js';
import { getScheduler } from '../../queue/scheduler.js';
import { MonitoringStatus } from '../../types/index.js';
import { AuthenticatedRequest, asyncHandler, createApiError } from '../middleware/index.js';
import { emitMonitoringUpdate } from '../../utils/socket-manager.js';

const skuIdSchema = z.object({ skuId: z.string().uuid() });
const toggleSchema = z.object({
  skuId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * POST /api/v1/monitor/start
 * Begin monitoring a SKU for stock changes.
 */
export const startMonitoring = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { skuId } = skuIdSchema.parse(req.body);
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const skuService = getSKUService();
  const sku = await skuService.getById(skuId);

  if (sku === null) {
    throw createApiError(`SKU not found: ${skuId}`, 404, 'NOT_FOUND');
  }

  if (sku.metadata.userId !== undefined && sku.metadata.userId !== userId) {
    throw createApiError('Access denied', 403, 'FORBIDDEN');
  }

  const scheduler = getScheduler();
  await scheduler.scheduleMonitoringForSKU(skuId);

  emitMonitoringUpdate({
    skuId,
    productId: sku.productId,
    retailer: sku.retailer,
    stockStatus: sku.currentStockStatus,
    price: sku.currentPrice,
    checkedAt: new Date().toISOString(),
  });

  res.json({
    data: {
      skuId,
      monitoring: true,
      message: `Monitoring started for SKU: ${sku.productName}`,
    },
  });
});

/**
 * POST /api/v1/monitor/stop
 * Stop monitoring a SKU.
 */
export const stopMonitoring = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { skuId } = skuIdSchema.parse(req.body);
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const skuService = getSKUService();
  const sku = await skuService.getById(skuId);

  if (sku === null) {
    throw createApiError(`SKU not found: ${skuId}`, 404, 'NOT_FOUND');
  }

  if (sku.metadata.userId !== undefined && sku.metadata.userId !== userId) {
    throw createApiError('Access denied', 403, 'FORBIDDEN');
  }

  const scheduler = getScheduler();
  await scheduler.unscheduleMonitoringForSKU(skuId);

  res.json({
    data: {
      skuId,
      monitoring: false,
      message: `Monitoring stopped for SKU: ${sku.productName}`,
    },
  });
});

/**
 * POST /api/v1/monitor/autocheckout
 * Toggle auto-checkout for a SKU.
 */
export const toggleAutoCheckout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { skuId, enabled } = toggleSchema.parse(req.body);
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const skuService = getSKUService();
  const sku = await skuService.getById(skuId);

  if (sku === null) {
    throw createApiError(`SKU not found: ${skuId}`, 404, 'NOT_FOUND');
  }

  if (sku.metadata.userId !== undefined && sku.metadata.userId !== userId) {
    throw createApiError('Access denied', 403, 'FORBIDDEN');
  }

  const updated = enabled
    ? await skuService.enableAutoCheckout(skuId)
    : await skuService.disableAutoCheckout(skuId);

  res.json({
    data: {
      skuId,
      autoCheckoutEnabled: updated.autoCheckoutEnabled,
      message: `Auto-checkout ${enabled ? 'enabled' : 'disabled'} for SKU: ${sku.productName}`,
    },
  });
});

/**
 * GET /api/v1/monitor/status
 * Returns monitoring state for all SKUs belonging to the authenticated user.
 */
export const getMonitoringStatus = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const skuService = getSKUService();
  const allResult = await skuService.getAll({ page: 1, limit: 1000 });
  const allSkus = allResult.data.filter((s) => s.metadata.userId === undefined || s.metadata.userId === userId);

  const statuses = allSkus.map((sku) => ({
    skuId: sku.id,
    productName: sku.productName,
    productUrl: sku.productUrl,
    retailer: sku.retailer,
    isMonitoring: sku.monitoringStatus === MonitoringStatus.ACTIVE,
    monitoringStatus: sku.monitoringStatus,
    autoCheckoutEnabled: sku.autoCheckoutEnabled,
    stockStatus: sku.currentStockStatus,
    currentPrice: sku.currentPrice,
    lastCheckedAt: sku.lastCheckedAt,
  }));

  res.json({ data: statuses });
});
