import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authMiddleware, createAuthRateLimit } from '../middleware/index.js';

const router = Router();

router.post('/register', createAuthRateLimit(), authController.register);
router.post('/login', createAuthRateLimit(), authController.login);
router.post('/refresh', createAuthRateLimit(), authController.refreshToken);

router.use(authMiddleware());

router.post('/logout', authController.logout);
router.get('/profile', authController.getProfile);
router.put('/profile', authController.updateProfile);
router.post('/change-password', authController.changePassword);

export default router;
