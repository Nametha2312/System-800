import { Response } from 'express';
import { z } from 'zod';
import { getAuthService } from '../../services/auth.service.js';
import { AuthenticatedRequest, asyncHandler, createApiError } from '../middleware/index.js';
import { getLogger } from '../../observability/logger.js';
import { passwordSchema, emailSchema } from '../../utils/validation.js';

const logger = getLogger().child({ controller: 'AuthController' });

// ── Validation schemas — all passwords require uppercase + digit + special char ─
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100).trim(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1), // no strength check on login (already hashed)
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  email: emailSchema.optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const register = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const input = registerSchema.parse(req.body);
  const authService = getAuthService();

  logger.info('User registration attempt', { email: input.email });

  const result = await authService.register(input);

  res.status(201).json({
    data: {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    },
  });
});

export const login = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const input = loginSchema.parse(req.body);
  const authService = getAuthService();

  logger.info('User login attempt', { email: input.email });

  const result = await authService.login(input);

  res.json({
    data: {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    },
  });
});

export const logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const authService = getAuthService();
  await authService.logout(userId);

  logger.info('User logged out', { userId });

  res.status(204).send();
});

export const refreshToken = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const input = refreshTokenSchema.parse(req.body);
  const authService = getAuthService();

  const result = await authService.refreshToken(input.refreshToken);

  res.json({
    data: {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    },
  });
});

export const getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const authService = getAuthService();
  const user = await authService.getUserById(userId);

  if (user === null) {
    throw createApiError('User not found', 404, 'NOT_FOUND');
  }

  const { passwordHash: _, ...sanitizedUser } = user;

  res.json({ data: sanitizedUser });
});

export const updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const input = updateProfileSchema.parse(req.body);
  const authService = getAuthService();

  logger.info('User profile update', { userId, updates: Object.keys(input) });

  const user = await authService.updateUser(userId, input);
  const { passwordHash: _, ...sanitizedUser } = user;

  res.json({ data: sanitizedUser });
});

export const changePassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.userId;

  if (userId === undefined) {
    throw createApiError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const input = changePasswordSchema.parse(req.body);
  const authService = getAuthService();

  logger.info('Password change request', { userId });

  await authService.changePassword(userId, input.oldPassword, input.newPassword);

  res.json({ message: 'Password changed successfully' });
});
