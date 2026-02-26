import { z } from 'zod';

import { RetailerType, StockStatus, MonitoringStatus, UserRole, ErrorSeverity } from '../types/index.js';

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email().max(255);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const urlSchema = z.string().url().max(2048);

export const retailerTypeSchema = z.nativeEnum(RetailerType);

export const stockStatusSchema = z.nativeEnum(StockStatus);

export const monitoringStatusSchema = z.nativeEnum(MonitoringStatus);

export const userRoleSchema = z.nativeEnum(UserRole);

export const errorSeveritySchema = z.nativeEnum(ErrorSeverity);

export const priceSchema = z.number().nonnegative().finite();

export const pollingIntervalSchema = z.number().int().min(10000).max(300000);

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const createSKUSchema = z.object({
  retailer: retailerTypeSchema,
  productId: z.string().min(1).max(255),
  productUrl: urlSchema,
  productName: z.string().min(1).max(500),
  targetPrice: priceSchema.nullable().optional(),
  autoCheckoutEnabled: z.boolean().default(false),
  pollingIntervalMs: pollingIntervalSchema.default(30000),
  metadata: z
    .object({
      imageUrl: urlSchema.optional(),
      category: z.string().max(255).optional(),
      brand: z.string().max(255).optional(),
      customSelectors: z
        .object({
          priceSelector: z.string().max(500).optional(),
          stockSelector: z.string().max(500).optional(),
          addToCartSelector: z.string().max(500).optional(),
          productNameSelector: z.string().max(500).optional(),
        })
        .optional(),
      notes: z.string().max(2000).optional(),
    })
    .optional()
    .default({}),
});

export const updateSKUSchema = createSKUSchema.partial().extend({
  monitoringStatus: monitoringStatusSchema.optional(),
});

export const createCredentialSchema = z.object({
  retailer: retailerTypeSchema,
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(255),
  paymentInfo: z.string().max(2000).nullable().optional(),
  shippingInfo: z.string().max(2000).nullable().optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: userRoleSchema.optional().default(UserRole.VIEWER),
});

export const idParamSchema = z.object({
  id: uuidSchema,
});

export type CreateSKUInput = z.infer<typeof createSKUSchema>;
export type UpdateSKUInput = z.infer<typeof updateSKUSchema>;
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;

export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation failed: ${errors}`);
  }
  return result.data;
}

export function validateSafe<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`),
  };
}

// Simple validation helper functions for tests
export function validateEmail(email: string): boolean {
  if (email == null) return false;
  return emailSchema.safeParse(email).success;
}

export function validatePassword(password: string): boolean {
  if (password == null) return false;
  return passwordSchema.safeParse(password).success;
}

export function validateUrl(url: string): boolean {
  if (url == null) return false;
  return urlSchema.safeParse(url).success;
}

export function validateUUID(uuid: string): boolean {
  if (uuid == null) return false;
  return uuidSchema.safeParse(uuid).success;
}

export function validatePriority(priority: number): boolean {
  if (priority == null || typeof priority !== 'number') return false;
  return Number.isInteger(priority) && priority >= 1 && priority <= 10;
}

export function validateCheckInterval(interval: number): boolean {
  if (interval == null || typeof interval !== 'number') return false;
  return Number.isInteger(interval) && interval >= 30 && interval <= 3600;
}

export function validatePrice(price: number): boolean {
  if (price == null || typeof price !== 'number') return false;
  return price >= 0 && Number.isFinite(price);
}

export function validateRetailer(retailer: RetailerType): boolean {
  if (retailer == null) return false;
  return retailerTypeSchema.safeParse(retailer).success;
}

export function sanitizeInput(input: string): string {
  if (input == null) return '';
  // Remove control characters
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
  // Escape HTML special characters
  sanitized = sanitized.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Trim whitespace
  return sanitized.trim();
}

export function validatePagination(input: { page?: number; limit?: number }): { page: number; limit: number } {
  let page = Number(input.page);
  let limit = Number(input.limit);
  
  // Handle NaN - use default
  if (isNaN(page)) page = 1;
  if (isNaN(limit)) limit = 20;
  
  // Clamp page to minimum of 1
  if (page < 1) page = 1;
  
  // Clamp limit to range 1-100
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;
  
  return { page, limit };
}
