import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validatePassword,
  validateUrl,
  validateUUID,
  validatePriority,
  validateCheckInterval,
  validatePrice,
  validateRetailer,
  sanitizeInput,
  validatePagination,
} from '../../utils/validation';
import { RetailerType } from '../../types';

describe('Validation Utils', () => {
  describe('validateEmail', () => {
    it('should return true for valid emails', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.co.uk')).toBe(true);
      expect(validateEmail('user+tag@gmail.com')).toBe(true);
      expect(validateEmail('a@b.co')).toBe(true);
    });

    it('should return false for invalid emails', () => {
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('test@')).toBe(false);
      expect(validateEmail('test@.com')).toBe(false);
      expect(validateEmail('test@example')).toBe(false);
      expect(validateEmail('test @example.com')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateEmail(null as unknown as string)).toBe(false);
      expect(validateEmail(undefined as unknown as string)).toBe(false);
      expect(validateEmail(123 as unknown as string)).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('should return true for valid passwords', () => {
      // Password requires: 8+ chars, uppercase, lowercase, number, special char
      expect(validatePassword('MyP@ssw0rd!')).toBe(true);
      expect(validatePassword('Test1234!')).toBe(true);
      expect(validatePassword('Str0ng#Pass')).toBe(true);
    });

    it('should return false for passwords too short', () => {
      expect(validatePassword('')).toBe(false);
      expect(validatePassword('Te$t1!')).toBe(false); // too short
      expect(validatePassword('pass')).toBe(false);
    });

    it('should return false for passwords too long', () => {
      expect(validatePassword('A1!a' + 'a'.repeat(125))).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validatePassword(null as unknown as string)).toBe(false);
      expect(validatePassword(undefined as unknown as string)).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('should return true for valid URLs', () => {
      expect(validateUrl('https://www.amazon.com/dp/B09BNFWW5V')).toBe(true);
      expect(validateUrl('http://example.com')).toBe(true);
      expect(validateUrl('https://bestbuy.com/product/123?id=456')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(validateUrl('')).toBe(false);
      expect(validateUrl('not-a-url')).toBe(false);
      // ftp:// and javascript: are considered valid URLs by Zod's URL validator
      expect(validateUrl('://missing-scheme.com')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateUrl(null as unknown as string)).toBe(false);
      expect(validateUrl(undefined as unknown as string)).toBe(false);
    });
  });

  describe('validateUUID', () => {
    it('should return true for valid UUIDs', () => {
      expect(validateUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(validateUUID('')).toBe(false);
      expect(validateUUID('not-a-uuid')).toBe(false);
      expect(validateUUID('123e4567-e89b-12d3-a456')).toBe(false);
      expect(validateUUID('123e4567-e89b-12d3-a456-42661417400g')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateUUID(null as unknown as string)).toBe(false);
      expect(validateUUID(undefined as unknown as string)).toBe(false);
    });
  });

  describe('validatePriority', () => {
    it('should return true for valid priorities', () => {
      expect(validatePriority(1)).toBe(true);
      expect(validatePriority(5)).toBe(true);
      expect(validatePriority(10)).toBe(true);
    });

    it('should return false for invalid priorities', () => {
      expect(validatePriority(0)).toBe(false);
      expect(validatePriority(11)).toBe(false);
      expect(validatePriority(-1)).toBe(false);
      expect(validatePriority(3.5)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validatePriority(null as unknown as number)).toBe(false);
      expect(validatePriority(undefined as unknown as number)).toBe(false);
      expect(validatePriority('5' as unknown as number)).toBe(false);
    });
  });

  describe('validateCheckInterval', () => {
    it('should return true for valid intervals', () => {
      expect(validateCheckInterval(30)).toBe(true);
      expect(validateCheckInterval(60)).toBe(true);
      expect(validateCheckInterval(3600)).toBe(true);
    });

    it('should return false for invalid intervals', () => {
      expect(validateCheckInterval(29)).toBe(false);
      expect(validateCheckInterval(3601)).toBe(false);
      expect(validateCheckInterval(-1)).toBe(false);
      expect(validateCheckInterval(45.5)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validateCheckInterval(null as unknown as number)).toBe(false);
      expect(validateCheckInterval(undefined as unknown as number)).toBe(false);
    });
  });

  describe('validatePrice', () => {
    it('should return true for valid prices', () => {
      expect(validatePrice(0)).toBe(true);
      expect(validatePrice(0.01)).toBe(true);
      expect(validatePrice(499.99)).toBe(true);
      expect(validatePrice(9999.99)).toBe(true);
    });

    it('should return false for invalid prices', () => {
      expect(validatePrice(-1)).toBe(false);
      expect(validatePrice(-0.01)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(validatePrice(null as unknown as number)).toBe(false);
      expect(validatePrice(undefined as unknown as number)).toBe(false);
      expect(validatePrice('100' as unknown as number)).toBe(false);
    });
  });

  describe('validateRetailer', () => {
    it('should return true for valid retailers', () => {
      expect(validateRetailer(RetailerType.AMAZON)).toBe(true);
      expect(validateRetailer(RetailerType.BESTBUY)).toBe(true);
      expect(validateRetailer(RetailerType.WALMART)).toBe(true);
      expect(validateRetailer(RetailerType.TARGET)).toBe(true);
      expect(validateRetailer(RetailerType.NEWEGG)).toBe(true);
      expect(validateRetailer(RetailerType.CUSTOM)).toBe(true);
    });

    it('should return false for invalid retailers', () => {
      expect(validateRetailer('invalid' as RetailerType)).toBe(false);
      expect(validateRetailer('' as RetailerType)).toBe(false);
      expect(validateRetailer('amazon' as RetailerType)).toBe(false); // lowercase should fail
    });

    it('should handle edge cases', () => {
      expect(validateRetailer(null as unknown as RetailerType)).toBe(false);
      expect(validateRetailer(undefined as unknown as RetailerType)).toBe(false);
    });
  });

  describe('sanitizeInput', () => {
    it('should trim whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
      expect(sanitizeInput('\n\ttest\n\t')).toBe('test');
    });

    it('should remove control characters', () => {
      expect(sanitizeInput('test\x00input')).toBe('testinput');
      expect(sanitizeInput('hello\x1Fworld')).toBe('helloworld');
    });

    it('should handle HTML special characters', () => {
      const input = '<script>alert("xss")</script>';
      const result = sanitizeInput(input);
      expect(result).not.toContain('<script>');
    });

    it('should preserve normal text', () => {
      expect(sanitizeInput('Hello World!')).toBe('Hello World!');
      expect(sanitizeInput('Test123')).toBe('Test123');
    });

    it('should handle empty strings', () => {
      expect(sanitizeInput('')).toBe('');
    });

    it('should handle edge cases', () => {
      expect(sanitizeInput(null as unknown as string)).toBe('');
      expect(sanitizeInput(undefined as unknown as string)).toBe('');
    });
  });

  describe('validatePagination', () => {
    it('should return valid pagination with defaults', () => {
      const result = validatePagination({});
      expect(result).toEqual({ page: 1, limit: 20 });
    });

    it('should parse valid pagination values', () => {
      const result = validatePagination({ page: '2', limit: '50' } as unknown as {
        page?: number;
        limit?: number;
      });
      expect(result).toEqual({ page: 2, limit: 50 });
    });

    it('should clamp page to minimum of 1', () => {
      const result = validatePagination({ page: 0 });
      expect(result.page).toBe(1);

      const result2 = validatePagination({ page: -5 });
      expect(result2.page).toBe(1);
    });

    it('should clamp limit to range 1-100', () => {
      const result = validatePagination({ limit: 0 });
      expect(result.limit).toBe(1);

      const result2 = validatePagination({ limit: 200 });
      expect(result2.limit).toBe(100);
    });

    it('should handle NaN values', () => {
      const result = validatePagination({
        page: NaN,
        limit: NaN,
      });
      expect(result).toEqual({ page: 1, limit: 20 });
    });
  });
});
