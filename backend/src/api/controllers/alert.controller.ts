import { Response } from 'express';
import { z } from 'zod';
import { getAlertService } from '../../services/alert.service.js';
import { AuthenticatedRequest, asyncHandler, createApiError } from '../middleware/index.js';
import { paginationSchema } from '../../utils/validation.js';
import { AlertType, AlertStatus } from '../../types/index.js';

const alertFilterSchema = z.object({
  skuId: z.string().uuid().optional(),
  type: z.nativeEnum(AlertType).optional(),
  status: z.nativeEnum(AlertStatus).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const getAllAlerts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const pagination = paginationSchema.parse(req.query);
  const filter = alertFilterSchema.parse(req.query);
  const alertService = getAlertService();

  // Map AlertStatus enum to isRead boolean for the service layer
  let isRead: boolean | undefined;
  if (filter.status === AlertStatus.ACKNOWLEDGED) {
    isRead = true;
  } else if (filter.status === AlertStatus.PENDING) {
    isRead = false;
  }

  const result = await alertService.getByFilter(
    {
      skuId: filter.skuId,
      type: filter.type,
      isRead,
      startDate: filter.startDate !== undefined ? new Date(filter.startDate) : undefined,
      endDate: filter.endDate !== undefined ? new Date(filter.endDate) : undefined,
    },
    pagination,
  );

  res.json({
    data: result.data,
    pagination: result.pagination,
  });
});

export const getAlertById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const alertService = getAlertService();

  const alert = await alertService.getById(id as string);

  if (alert === null) {
    throw createApiError(`Alert not found: ${id}`, 404, 'NOT_FOUND');
  }

  res.json({ data: alert });
});

export const getUnacknowledgedAlerts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const alertService = getAlertService();

  const alerts = await alertService.getUnacknowledged();

  res.json({ data: alerts });
});

export const acknowledgeAlert = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const alertService = getAlertService();

  const alert = await alertService.acknowledge(id as string);

  res.json({ data: alert, message: 'Alert acknowledged' });
});

export const acknowledgeAllAlerts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { skuId } = req.query;
  const alertService = getAlertService();

  const count = await alertService.acknowledgeAll(skuId as string | undefined);

  res.json({ message: `${count} alerts acknowledged` });
});

export const getAlertsBySKU = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { skuId } = req.params;
  const { limit } = req.query;
  const alertService = getAlertService();

  const alerts = await alertService.getRecentBySKU(
    skuId as string,
    limit !== undefined ? Number(limit) : undefined,
  );

  res.json({ data: alerts });
});

export const getAlertCounts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const alertService = getAlertService();

  const counts = await alertService.getAlertCounts();

  res.json({ data: counts });
});
