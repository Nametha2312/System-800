import crypto from 'crypto';

import { getConfig } from '../config/index.js';

const ALGORITHM = 'aes-256-cbc';

export interface EncryptionService {
  encrypt(plainText: string): string;
  decrypt(encryptedText: string): string;
}

class AESEncryptionService implements EncryptionService {
  private readonly key: Buffer;
  private readonly ivLength: number;

  constructor(key: string, ivLength: number = 16) {
    // Truncate or pad key to exactly 32 characters
    const normalizedKey = key.length >= 32 ? key.slice(0, 32) : key.padEnd(32, '0');
    this.key = Buffer.from(normalizedKey, 'utf8');
    this.ivLength = ivLength;
  }

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const ivHex = iv.toString('hex');
    return `${ivHex}:${encrypted}`;
  }

  decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':');

    if (ivHex === undefined || encrypted === undefined) {
      throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

let encryptionInstance: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (encryptionInstance === null) {
    const config = getConfig();
    encryptionInstance = new AESEncryptionService(
      config.encryption.key,
      config.encryption.ivLength,
    );
  }
  return encryptionInstance;
}

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err: Error | null, derivedKey: Buffer) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, storedHash] = hash.split(':');

    if (salt === undefined || storedHash === undefined) {
      resolve(false);
      return;
    }

    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err: Error | null, derivedKey: Buffer) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), derivedKey));
    });
  });
}

export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function generateUUID(): string {
  return crypto.randomUUID();
}

// Export AESEncryptionService as Encryption for tests
export { AESEncryptionService };
export const Encryption = AESEncryptionService;
