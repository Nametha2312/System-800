/**
 * SKU route request validators.
 * All validators use Zod and return 400 on failure via the error middleware.
 */
import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import {
  createSKUSchema,
  updateSKUSchema,
  paginationSchema,
  uuidSchema,
} from '../../utils/validation.js';

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

function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      const err = Object.assign(new Error(messages), { statusCode: 400, code: 'VALIDATION_ERROR' });
      res.status(400);
      return next(err);
    }
    req.query = result.data as typeof req.query;
    next();
  };
}

function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const messages = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      const err = Object.assign(new Error(messages), { statusCode: 400, code: 'VALIDATION_ERROR' });
      res.status(400);
      return next(err);
    }
    next();
  };
}

const idParamSchema = z.object({ id: uuidSchema });

export const validateCreateSKU = validateBody(createSKUSchema);
export const validateUpdateSKU = validateBody(updateSKUSchema);
export const validateSKUPagination = validateQuery(paginationSchema);
export const validateSKUId = validateParams(idParamSchema);
