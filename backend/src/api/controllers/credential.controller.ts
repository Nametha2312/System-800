import { Response } from 'express';
import { z } from 'zod';
import { getCredentialService } from '../../services/credential.service.js';
import { getEncryptionService } from '../../utils/encryption.js';
import { AuthenticatedRequest, asyncHandler, createApiError } from '../middleware/index.js';
import { RetailerCredential, RetailerType } from '../../types/index.js';
import { getLogger } from '../../observability/logger.js';

const logger = getLogger().child({ controller: 'CredentialController' });

/** Strip encrypted fields and add decrypted `username` for safe API responses */
function sanitizeCredential(credential: RetailerCredential): Record<string, unknown> {
  const encryption = getEncryptionService();
  const { encryptedPassword: _p, encryptedUsername: _u, ...rest } = credential;
  return {
    ...rest,
    username: encryption.decrypt(credential.encryptedUsername),
  };
}

const createCredentialSchema = z.object({
  retailer: z.nativeEnum(RetailerType),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(255),
  paymentMethodId: z.string().optional(),
  shippingAddressId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateCredentialSchema = z.object({
  username: z.string().min(1).max(255).optional(),
  password: z.string().min(1).max(255).optional(),
  paymentMethodId: z.string().optional(),
  shippingAddressId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const createCredential = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const input = createCredentialSchema.parse(req.body);
  const credentialService = getCredentialService();

  logger.info('Creating credential', { userId, retailer: input.retailer });

  const credential = await credentialService.create({
    userId,
    ...input,
  });

  res.status(201).json({ data: sanitizeCredential(credential) });
});

export const updateCredential = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  const { id } = req.params;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const input = updateCredentialSchema.parse(req.body);
  const credentialService = getCredentialService();

  const existing = await credentialService.getById(id as string);
  if (existing === null || existing.userId !== userId) {
    throw createApiError(`Credential not found: ${id}`, 404, 'NOT_FOUND');
  }

  logger.info('Updating credential', { userId, credentialId: id });

  const credential = await credentialService.update(id as string, input);

  res.json({ data: sanitizeCredential(credential) });
});

export const deleteCredential = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  const { id } = req.params;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const credentialService = getCredentialService();

  const existing = await credentialService.getById(id as string);
  if (existing === null || existing.userId !== userId) {
    throw createApiError(`Credential not found: ${id}`, 404, 'NOT_FOUND');
  }

  logger.info('Deleting credential', { userId, credentialId: id });

  await credentialService.delete(id as string);

  res.status(204).send();
});

export const getCredentialById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  const { id } = req.params;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const credentialService = getCredentialService();

  const credential = await credentialService.getById(id as string);
  if (credential === null || credential.userId !== userId) {
    throw createApiError(`Credential not found: ${id}`, 404, 'NOT_FOUND');
  }

  res.json({ data: sanitizeCredential(credential) });
});

export const getMyCredentials = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const credentialService = getCredentialService();

  const credentials = await credentialService.getAllForUser(userId);

  const safeCredentials = credentials.map((c) => sanitizeCredential(c));

  res.json({ data: safeCredentials });
});

export const getCredentialByRetailer = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  const { retailer } = req.params;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  if (!Object.values(RetailerType).includes(retailer as RetailerType)) {
    throw createApiError(`Invalid retailer: ${retailer}`, 400, 'VALIDATION_ERROR');
  }

  const credentialService = getCredentialService();

  const credential = await credentialService.getByUserAndRetailer(userId, retailer as RetailerType);

  if (credential === null) {
    throw createApiError(`No credential found for retailer: ${retailer}`, 404, 'NOT_FOUND');
  }

  res.json({ data: sanitizeCredential(credential) });
});

export const validateCredential = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;
  const { id } = req.params;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const credentialService = getCredentialService();

  const existing = await credentialService.getById(id as string);
  if (existing === null || existing.userId !== userId) {
    throw createApiError(`Credential not found: ${id}`, 404, 'NOT_FOUND');
  }

  const isValid = await credentialService.validateCredential(id as string);

  res.json({
    data: { isValid },
    message: isValid ? 'Credential is valid' : 'Credential validation failed',
  });
});
