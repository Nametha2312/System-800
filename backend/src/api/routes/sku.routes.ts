import { Router } from 'express';
import * as skuController from '../controllers/sku.controller.js';
import { authMiddleware, createApiRateLimit } from '../middleware/index.js';

const router = Router();

router.use(authMiddleware());
router.use(createApiRateLimit());

router.get('/', skuController.getAllSKUs);
router.get('/statistics', skuController.getSKUStatistics);
router.get('/:id', skuController.getSKUById);
router.post('/', skuController.createSKU);
router.put('/:id', skuController.updateSKU);
router.delete('/:id', skuController.deleteSKU);

router.post('/:id/monitoring/start', skuController.startMonitoring);
router.post('/:id/monitoring/pause', skuController.pauseMonitoring);
router.post('/:id/monitoring/stop', skuController.stopMonitoring);

router.post('/:id/auto-checkout/enable', skuController.enableAutoCheckout);
router.post('/:id/auto-checkout/disable', skuController.disableAutoCheckout);

export default router;
