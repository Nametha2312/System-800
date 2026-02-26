/**
 * Auth route request validators.
 */
import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { emailSchema, passwordSchema } from '../../utils/validation.js';

function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      const err = Object.assign(new Error(messages), { statusCode: 400, code: 'VALIDATION_ERROR' });
      res.status(400);
      return next(err);
    }
    req.body = result.data;
    next();
  };
}

const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100).trim(),
});

const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordBodySchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const updateProfileBodySchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  email: emailSchema.optional(),
});

export const validateRegister = validateBody(registerBodySchema);
export const validateLogin = validateBody(loginBodySchema);
export const validateRefreshToken = validateBody(refreshBodySchema);
export const validateChangePassword = validateBody(changePasswordBodySchema);
export const validateUpdateProfile = validateBody(updateProfileBodySchema);
