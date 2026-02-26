import { Router } from 'express';
import skuRoutes from './sku.routes.js';
import authRoutes from './auth.routes.js';
import alertRoutes from './alert.routes.js';
import checkoutRoutes from './checkout.routes.js';
import credentialRoutes from './credential.routes.js';
import systemRoutes from './system.routes.js';
import monitorRoutes from './monitor.routes.js';

const router = Router();

router.use('/skus', skuRoutes);
router.use('/auth', authRoutes);
router.use('/alerts', alertRoutes);
router.use('/checkouts', checkoutRoutes);
router.use('/credentials', credentialRoutes);
router.use('/system', systemRoutes);
router.use('/monitor', monitorRoutes);

export default router;
