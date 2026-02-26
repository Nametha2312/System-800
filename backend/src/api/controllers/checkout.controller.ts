import { Response } from 'express';
import { z } from 'zod';
import { getCheckoutService } from '../../services/checkout.service.js';
import { getQueueManager } from '../../queue/queues.js';
import { getSKUService } from '../../services/sku.service.js';
import { AuthenticatedRequest, asyncHandler, createApiError } from '../middleware/index.js';
import { paginationSchema } from '../../utils/validation.js';
import { getLogger } from '../../observability/logger.js';

const logger = getLogger().child({ controller: 'CheckoutController' });

const initiateCheckoutSchema = z.object({
  skuId: z.string().uuid(),
  maxPrice: z.number().positive().optional(),
  quantity: z.number().int().positive().default(1),
});

export const initiateCheckout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const input = initiateCheckoutSchema.parse(req.body);
  const checkoutService = getCheckoutService();
  const skuService = getSKUService();

  const sku = await skuService.getById(input.skuId);
  if (sku === null) {
    throw createApiError(`SKU not found: ${input.skuId}`, 404, 'NOT_FOUND');
  }

  logger.info('Initiating checkout', {
    userId,
    skuId: input.skuId,
    maxPrice: input.maxPrice,
    quantity: input.quantity,
  });

  const result = await checkoutService.attemptCheckout({
    skuId: input.skuId,
    userId,
    maxPrice: input.maxPrice,
    quantity: input.quantity,
  });

  res.status(202).json({
    data: result,
    message: 'Checkout initiated',
  });
});

export const queueCheckout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const input = initiateCheckoutSchema.parse(req.body);
  const skuService = getSKUService();
  const queueManager = getQueueManager();

  const sku = await skuService.getById(input.skuId);
  if (sku === null) {
    throw createApiError(`SKU not found: ${input.skuId}`, 404, 'NOT_FOUND');
  }

  logger.info('Queueing checkout', {
    userId,
    skuId: input.skuId,
  });

  const jobId = await queueManager.addCheckoutJob({
    skuId: input.skuId,
    userId,
    retailer: sku.retailer,
    productUrl: sku.productUrl,
    productId: sku.productId,
    maxPrice: input.maxPrice,
    quantity: input.quantity,
    triggeredBy: 'manual',
  });

  res.status(202).json({
    data: { jobId },
    message: 'Checkout queued',
  });
});

export const getCheckoutById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const checkoutService = getCheckoutService();

  const attempt = await checkoutService.getAttemptById(id as string);

  if (attempt === null) {
    throw createApiError(`Checkout attempt not found: ${id}`, 404, 'NOT_FOUND');
  }

  res.json({ data: attempt });
});

export const getCheckoutsBySKU = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { skuId } = req.params;
  const pagination = paginationSchema.parse(req.query);
  const checkoutService = getCheckoutService();

  const result = await checkoutService.getAttemptsBySKU(skuId as string, pagination);

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

export const getMyCheckouts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const pagination = paginationSchema.parse(req.query);
  const checkoutService = getCheckoutService();

  const result = await checkoutService.getAttemptsByUser(userId, pagination);

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

export const cancelCheckout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const checkoutService = getCheckoutService();

  logger.info('Cancelling checkout', {
    userId: req.user?.userId,
    attemptId: id,
  });

  const attempt = await checkoutService.cancelAttempt(id as string);

  res.json({ data: attempt, message: 'Checkout cancelled' });
});

export const getCheckoutStatistics = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const checkoutService = getCheckoutService();

  const stats = await checkoutService.getCheckoutStatistics();

  res.json({ data: stats });
});

export const getRecentCheckouts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { limit } = req.query;
  const checkoutService = getCheckoutService();

  const attempts = await checkoutService.getRecentAttempts(
    limit !== undefined ? Number(limit) : undefined,
  );

  res.json({ data: attempts });
});

export const clearMyCheckouts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const checkoutService = getCheckoutService();
  const count = await checkoutService.clearAttemptsByUser(userId);

  res.json({ message: `${count} checkout attempt(s) deleted` });
});
