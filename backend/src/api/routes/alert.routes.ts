import { Router } from 'express';
import * as alertController from '../controllers/alert.controller.js';
import { authMiddleware, createApiRateLimit } from '../middleware/index.js';

const router = Router();

router.use(authMiddleware());
router.use(createApiRateLimit());

router.get('/', alertController.getAllAlerts);
router.get('/unacknowledged', alertController.getUnacknowledgedAlerts);
router.get('/counts', alertController.getAlertCounts);
router.get('/sku/:skuId', alertController.getAlertsBySKU);
router.get('/:id', alertController.getAlertById);
router.post('/:id/acknowledge', alertController.acknowledgeAlert);
router.post('/acknowledge-all', alertController.acknowledgeAllAlerts);

export default router;
