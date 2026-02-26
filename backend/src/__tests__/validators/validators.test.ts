/**
 * Tests for the validator middleware in api/validators.
 * Verifies that request validation correctly accepts/rejects inputs
 * and passes appropriate error responses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(body: unknown = {}, query: unknown = {}, params: unknown = {}): Request {
  return { body, query, params } as unknown as Request;
}

function makeRes(): { res: Response; statusMock: ReturnType<typeof vi.fn>; jsonMock: ReturnType<typeof vi.fn> } {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  const res = { status: statusMock, json: jsonMock } as unknown as Response;
  return { res, statusMock, jsonMock };
}

// ── Import validators ────────────────────────────────────────────────────────
// These are pure Zod middleware — no external dependencies
import {
  validateRegister,
  validateLogin,
  validateRefreshToken,
  validateChangePassword,
} from '../../api/validators/auth.validators.js';

import {
  validateCreateSKU,
  validateUpdateSKU,
  validateSKUId,
  validateSKUPagination,
} from '../../api/validators/sku.validators.js';

// ── Auth Validators ──────────────────────────────────────────────────────────

describe('Auth Validators', () => {
  describe('validateRegister', () => {
    it('passes with valid strong password', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'user@example.com', password: 'SecurePass1!', name: 'Alice' });

      validateRegister(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith(); // called with no args = success
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects password without uppercase letter', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'user@example.com', password: 'weakpass1!', name: 'Alice' });

      validateRegister(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects password without special character', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'user@example.com', password: 'WeakPass1', name: 'Alice' });

      validateRegister(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects password without digit', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'user@example.com', password: 'WeakPass!', name: 'Alice' });

      validateRegister(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('rejects invalid email', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'not-an-email', password: 'SecurePass1!', name: 'Alice' });

      validateRegister(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('rejects missing name', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'user@example.com', password: 'SecurePass1!' });

      validateRegister(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe('validateLogin', () => {
    it('passes with valid email and any non-empty password', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'user@example.com', password: 'anypassword' });

      validateLogin(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects empty password', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ email: 'user@example.com', password: '' });

      validateLogin(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('rejects missing email', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ password: 'somepassword' });

      validateLogin(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe('validateRefreshToken', () => {
    it('passes with a valid token string', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ refreshToken: 'some-valid-refresh-token-value' });

      validateRefreshToken(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects missing refreshToken', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({});

      validateRefreshToken(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe('validateChangePassword', () => {
    it('passes with valid current + strong new password', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ oldPassword: 'OldPass1!', newPassword: 'NewSecure2@' });

      validateChangePassword(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects weak new password', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ oldPassword: 'OldPass1!', newPassword: 'weakonly' });

      validateChangePassword(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });
});

// ── SKU Validators ────────────────────────────────────────────────────────────

describe('SKU Validators', () => {
  describe('validateCreateSKU', () => {
    it('passes with valid Walmart URL and required fields', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({
        retailer: 'WALMART',
        productId: 'abc123',
        productUrl: 'https://www.walmart.com/ip/product/12345',
        productName: 'Test Product',
        targetPrice: 49.99,
        pollingIntervalMs: 60000,
      });

      validateCreateSKU(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects invalid URL', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({
        retailer: 'WALMART',
        productId: 'abc123',
        productName: 'Test Product',
        productUrl: 'not-a-url',
      });

      validateCreateSKU(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('rejects missing retailer', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({
        productId: 'abc123',
        productName: 'Test Product',
        productUrl: 'https://www.walmart.com/ip/product/12345',
      });

      validateCreateSKU(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('rejects negative targetPrice', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({
        retailer: 'WALMART',
        productId: 'abc123',
        productName: 'Test Product',
        productUrl: 'https://www.walmart.com/ip/product/12345',
        targetPrice: -10,
      });

      validateCreateSKU(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('rejects pollingIntervalMs below minimum (10s)', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({
        retailer: 'WALMART',
        productId: 'abc123',
        productName: 'Test Product',
        productUrl: 'https://www.walmart.com/ip/product/12345',
        pollingIntervalMs: 1000, // too low
      });

      validateCreateSKU(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe('validateUpdateSKU', () => {
    it('passes with partial valid fields', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({ targetPrice: 29.99 });

      validateUpdateSKU(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('passes with empty body (all fields optional)', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({});

      validateUpdateSKU(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });
  });

  describe('validateSKUId', () => {
    it('passes valid UUID in params', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({}, {}, { id: '550e8400-e29b-41d4-a716-446655440000' });

      validateSKUId(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects non-UUID id param', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({}, {}, { id: 'not-a-uuid' });

      validateSKUId(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('rejects missing id param', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({}, {}, {});

      validateSKUId(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });

  describe('validateSKUPagination', () => {
    it('passes with valid page and limit', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({}, { page: '1', limit: '20' });

      validateSKUPagination(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('passes with empty query (uses defaults)', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({}, {});

      validateSKUPagination(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledWith();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('rejects limit exceeding max (100)', () => {
      const next = vi.fn();
      const { res, statusMock } = makeRes();
      const req = makeReq({}, { page: '1', limit: '200' });

      validateSKUPagination(req, res, next as NextFunction);

      expect(statusMock).toHaveBeenCalledWith(400);
    });
  });
});
