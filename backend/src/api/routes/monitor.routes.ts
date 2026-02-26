import { Router } from 'express';
import * as monitorController from '../controllers/monitor.controller.js';
import { authMiddleware, createApiRateLimit } from '../middleware/index.js';

const router = Router();

router.use(authMiddleware());
router.use(createApiRateLimit());

router.post('/start', monitorController.startMonitoring);
router.post('/stop', monitorController.stopMonitoring);
router.post('/autocheckout', monitorController.toggleAutoCheckout);
router.get('/status', monitorController.getMonitoringStatus);

export default router;
