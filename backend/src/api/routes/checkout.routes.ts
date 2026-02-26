import { Router } from 'express';
import * as checkoutController from '../controllers/checkout.controller.js';
import { authMiddleware, createCheckoutRateLimit, createApiRateLimit } from '../middleware/index.js';

const router = Router();

router.use(authMiddleware());

router.post('/', createCheckoutRateLimit(), checkoutController.initiateCheckout);
router.post('/queue', createCheckoutRateLimit(), checkoutController.queueCheckout);

router.use(createApiRateLimit());

router.get('/my', checkoutController.getMyCheckouts);
router.get('/recent', checkoutController.getRecentCheckouts);
router.get('/statistics', checkoutController.getCheckoutStatistics);
router.delete('/my', checkoutController.clearMyCheckouts);
router.get('/sku/:skuId', checkoutController.getCheckoutsBySKU);
router.get('/:id', checkoutController.getCheckoutById);
router.post('/:id/cancel', checkoutController.cancelCheckout);

export default router;
