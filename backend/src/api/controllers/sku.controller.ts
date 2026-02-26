import { Response } from 'express';
import { getSKUService } from '../../services/sku.service.js';
import { getScheduler } from '../../queue/scheduler.js';
import { AuthenticatedRequest, asyncHandler, createApiError } from '../middleware/index.js';
import { createSKUSchema, updateSKUSchema, paginationSchema } from '../../utils/validation.js';
import { getLogger } from '../../observability/logger.js';

const logger = getLogger().child({ controller: 'SKUController' });

export const getAllSKUs = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pagination = paginationSchema.parse(req.query);
  const skuService = getSKUService();

  const result = await skuService.getAll(pagination);

  res.json({
    data: result.data,
    pagination: {
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      totalPages: result.pagination.totalPages,
    },
  });
});

export const getSKUById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const skuService = getSKUService();

  const sku = await skuService.getById(id as string);

  if (sku === null) {
    throw createApiError(`SKU not found: ${id}`, 404, 'NOT_FOUND');
  }

  res.json({ data: sku });
});

export const createSKU = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const input = createSKUSchema.parse(req.body);
  const skuService = getSKUService();

  logger.info('Creating SKU', { userId: req.user?.userId, input });

  const sku = await skuService.create(input);

  res.status(201).json({ data: sku });
});

export const updateSKU = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const input = updateSKUSchema.parse(req.body);
  const skuService = getSKUService();

  logger.info('Updating SKU', { userId: req.user?.userId, skuId: id, input });

  const sku = await skuService.update(id as string, input);

  res.json({ data: sku });
});

export const deleteSKU = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const skuService = getSKUService();
  const scheduler = getScheduler();

  logger.info('Deleting SKU', { userId: req.user?.userId, skuId: id });

  await scheduler.unscheduleMonitoringForSKU(id as string);
  const result = await skuService.delete(id as string);

  if (!result) {
    throw createApiError(`SKU not found: ${id}`, 404, 'NOT_FOUND');
  }

  res.status(204).send();
});

export const startMonitoring = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const skuService = getSKUService();
  const scheduler = getScheduler();

  logger.info('Starting monitoring for SKU', { userId: req.user?.userId, skuId: id });

  const sku = await skuService.startMonitoring(id as string);
  await scheduler.scheduleMonitoringForSKU(id as string);

  res.json({ data: sku, message: 'Monitoring started' });
});

export const pauseMonitoring = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const skuService = getSKUService();
  const scheduler = getScheduler();

  logger.info('Pausing monitoring for SKU', { userId: req.user?.userId, skuId: id });

  const sku = await skuService.pauseMonitoring(id as string);
  await scheduler.unscheduleMonitoringForSKU(id as string);

  res.json({ data: sku, message: 'Monitoring paused' });
});

export const stopMonitoring = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const skuService = getSKUService();
  const scheduler = getScheduler();

  logger.info('Stopping monitoring for SKU', { userId: req.user?.userId, skuId: id });

  const sku = await skuService.stopMonitoring(id as string);
  await scheduler.unscheduleMonitoringForSKU(id as string);

  res.json({ data: sku, message: 'Monitoring stopped' });
});

export const enableAutoCheckout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const skuService = getSKUService();

  logger.info('Enabling auto-checkout for SKU', { userId: req.user?.userId, skuId: id });

  const sku = await skuService.enableAutoCheckout(id as string);

  res.json({ data: sku, message: 'Auto-checkout enabled' });
});

export const disableAutoCheckout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const skuService = getSKUService();

  logger.info('Disabling auto-checkout for SKU', { userId: req.user?.userId, skuId: id });

  const sku = await skuService.disableAutoCheckout(id as string);

  res.json({ data: sku, message: 'Auto-checkout disabled' });
});

export const getSKUStatistics = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const skuService = getSKUService();

  const statistics = await skuService.getStatistics();

  res.json({ data: statistics });
});
