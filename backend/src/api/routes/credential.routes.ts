import { Router } from 'express';
import * as credentialController from '../controllers/credential.controller.js';
import { authMiddleware, createApiRateLimit, createStrictRateLimit } from '../middleware/index.js';

const router = Router();

router.use(authMiddleware());

router.get('/', createApiRateLimit(), credentialController.getMyCredentials);
router.post('/', createApiRateLimit(), credentialController.createCredential);

router.get('/retailer/:retailer', createApiRateLimit(), credentialController.getCredentialByRetailer);
router.get('/:id', createApiRateLimit(), credentialController.getCredentialById);
router.put('/:id', createStrictRateLimit(), credentialController.updateCredential);
router.delete('/:id', createStrictRateLimit(), credentialController.deleteCredential);
router.post('/:id/validate', createStrictRateLimit(), credentialController.validateCredential);

export default router;
