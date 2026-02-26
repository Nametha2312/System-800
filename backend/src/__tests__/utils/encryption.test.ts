import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Encryption } from '../../utils/encryption';

describe('Encryption', () => {
  let encryption: InstanceType<typeof Encryption>;
  const testKey = 'test-encryption-key-exactly32ch';

  beforeEach(() => {
    encryption = new Encryption(testKey);
  });

  describe('encrypt', () => {
    it('should encrypt a plain text string', () => {
      const plainText = 'my-secret-password';
      const encrypted = encryption.encrypt(plainText);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plainText);
      expect(encrypted).toContain(':'); // IV separator
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plainText = 'my-secret-password';
      const encrypted1 = encryption.encrypt(plainText);
      const encrypted2 = encryption.encrypt(plainText);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle empty string', () => {
      const encrypted = encryption.encrypt('');
      expect(encrypted).toBeDefined();
      expect(encrypted).toContain(':');
    });

    it('should handle unicode characters', () => {
      const plainText = '密码🔐テスト';
      const encrypted = encryption.encrypt(plainText);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plainText);
    });

    it('should handle special characters', () => {
      const plainText = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = encryption.encrypt(plainText);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plainText);
    });

    it('should handle very long strings', () => {
      const plainText = 'a'.repeat(10000);
      const encrypted = encryption.encrypt(plainText);

      expect(encrypted).toBeDefined();
      expect(encrypted.length).toBeGreaterThan(plainText.length);
    });
  });

  describe('decrypt', () => {
    it('should decrypt an encrypted string', () => {
      const plainText = 'my-secret-password';
      const encrypted = encryption.encrypt(plainText);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('should correctly decrypt empty string', () => {
      const encrypted = encryption.encrypt('');
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe('');
    });

    it('should correctly decrypt unicode characters', () => {
      const plainText = '密码🔐テスト';
      const encrypted = encryption.encrypt(plainText);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('should correctly decrypt special characters', () => {
      const plainText = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = encryption.encrypt(plainText);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('should correctly decrypt very long strings', () => {
      const plainText = 'a'.repeat(10000);
      const encrypted = encryption.encrypt(plainText);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
    });

    it('should throw error for invalid encrypted data (no IV separator)', () => {
      expect(() => encryption.decrypt('invalid-no-separator')).toThrow();
    });

    it('should throw error for tampered ciphertext', () => {
      const encrypted = encryption.encrypt('test');
      const [iv, cipher] = encrypted.split(':');
      const tampered = `${iv}:${cipher.slice(0, -2)}00`;

      expect(() => encryption.decrypt(tampered)).toThrow();
    });

    it('should throw error for wrong key', () => {
      const encrypted = encryption.encrypt('test');
      const wrongKeyEncryption = new Encryption('different-key-32-chars-longxxxx');

      expect(() => wrongKeyEncryption.decrypt(encrypted)).toThrow();
    });
  });

  describe('roundtrip', () => {
    it('should successfully roundtrip multiple times', () => {
      let text = 'original-secret';

      for (let i = 0; i < 10; i++) {
        const encrypted = encryption.encrypt(text);
        const decrypted = encryption.decrypt(encrypted);
        expect(decrypted).toBe(text);
      }
    });

    it('should handle JSON data', () => {
      const data = { username: 'test', password: 'secret123', nested: { key: 'value' } };
      const plainText = JSON.stringify(data);
      const encrypted = encryption.encrypt(plainText);
      const decrypted = encryption.decrypt(encrypted);
      const parsed = JSON.parse(decrypted);

      expect(parsed).toEqual(data);
    });
  });

  describe('key validation', () => {
    it('should work with 32-character key', () => {
      const key32 = 'a'.repeat(32);
      const enc = new Encryption(key32);
      const encrypted = enc.encrypt('test');
      const decrypted = enc.decrypt(encrypted);

      expect(decrypted).toBe('test');
    });

    it('should work with key longer than 32 characters (truncated)', () => {
      const longKey = 'a'.repeat(64);
      const enc = new Encryption(longKey);
      const encrypted = enc.encrypt('test');
      const decrypted = enc.decrypt(encrypted);

      expect(decrypted).toBe('test');
    });
  });
});
