import { Router } from 'express';
import * as systemController from '../controllers/system.controller.js';
import { authMiddleware, createApiRateLimit } from '../middleware/index.js';

const router = Router();

// Public endpoints - no auth required
router.get('/health', systemController.healthCheck);
router.get('/health/detailed', systemController.healthCheckDetailed);

// Prometheus scrape endpoint - no auth so Prometheus can scrape it
// In production, restrict via network/firewall, not auth
router.get('/metrics/prometheus', systemController.getPrometheusMetrics);

router.use(authMiddleware());
router.use(createApiRateLimit());

router.get('/metrics', systemController.getMetrics);
router.get('/queues', systemController.getQueueStats);
router.get('/workers', systemController.getWorkerStatus);
router.get('/scheduler', systemController.getSchedulerStatus);
router.get('/info', systemController.getSystemInfo);

export default router;
