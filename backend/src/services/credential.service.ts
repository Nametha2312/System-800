import { RetailerCredential, RetailerType } from '../types/index.js';
import {
  getCredentialRepository,
  CredentialRepository,
} from '../persistence/repositories/credential.repository.js';
import { EncryptionService, getEncryptionService } from '../utils/encryption.js';
import { getLogger, Logger } from '../observability/logger.js';

export interface CreateCredentialInput {
  userId: string;
  retailer: RetailerType;
  username: string;
  password: string;
  paymentMethodId?: string;
  shippingAddressId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCredentialInput {
  username?: string;
  password?: string;
  paymentMethodId?: string;
  shippingAddressId?: string;
  metadata?: Record<string, unknown>;
}

export interface CredentialService {
  create(input: CreateCredentialInput): Promise<RetailerCredential>;
  update(id: string, input: UpdateCredentialInput): Promise<RetailerCredential>;
  delete(id: string): Promise<boolean>;
  getById(id: string): Promise<RetailerCredential | null>;
  getByUserAndRetailer(userId: string, retailer: RetailerType): Promise<RetailerCredential | null>;
  getAllForUser(userId: string): Promise<RetailerCredential[]>;
  validateCredential(id: string): Promise<boolean>;
  decryptPassword(credential: RetailerCredential): string;
}

class CredentialServiceImpl implements CredentialService {
  private readonly repository: CredentialRepository;
  private readonly encryption: EncryptionService;
  private readonly logger: Logger;

  constructor(repository?: CredentialRepository, encryption?: EncryptionService) {
    this.repository = repository ?? getCredentialRepository();
    this.encryption = encryption ?? getEncryptionService();
    this.logger = getLogger().child({ service: 'CredentialService' });
  }

  async create(input: CreateCredentialInput): Promise<RetailerCredential> {
    this.logger.info('Creating retailer credential', {
      userId: input.userId,
      retailer: input.retailer,
    });

    const existing = await this.repository.findByUserAndRetailer(input.userId, input.retailer);
    if (existing !== null) {
      throw new Error(
        `Credential already exists for user ${input.userId} and retailer ${input.retailer}`,
      );
    }

    const encryptedPassword = this.encryption.encrypt(input.password);
    const encryptedUsername = this.encryption.encrypt(input.username);

    const credential = await this.repository.create({
      userId: input.userId,
      retailer: input.retailer,
      encryptedUsername,
      encryptedPassword,
      encryptedPaymentInfo: input.paymentMethodId ? this.encryption.encrypt(input.paymentMethodId) : null,
      encryptedShippingInfo: input.shippingAddressId ? this.encryption.encrypt(input.shippingAddressId) : null,
      isValid: true,
      lastValidatedAt: new Date(),
      expiresAt: null,
    });

    this.logger.info('Credential created successfully', { credentialId: credential.id });
    return credential;
  }

  async update(id: string, input: UpdateCredentialInput): Promise<RetailerCredential> {
    this.logger.info('Updating credential', { credentialId: id });

    const existing = await this.repository.findById(id);
    if (existing === null) {
      throw new Error(`Credential not found: ${id}`);
    }

    const updates: Record<string, unknown> = {};

    if (input.username !== undefined) {
      updates['encryptedUsername'] = this.encryption.encrypt(input.username);
    }

    if (input.password !== undefined) {
      updates['encryptedPassword'] = this.encryption.encrypt(input.password);
    }

    if (input.paymentMethodId !== undefined) {
      updates['encryptedPaymentInfo'] = input.paymentMethodId ? this.encryption.encrypt(input.paymentMethodId) : null;
    }

    if (input.shippingAddressId !== undefined) {
      updates['encryptedShippingInfo'] = input.shippingAddressId ? this.encryption.encrypt(input.shippingAddressId) : null;
    }

    const credential = await this.repository.update(id, updates as Partial<Omit<RetailerCredential, 'id' | 'createdAt' | 'updatedAt'>>);
    if (credential === null) {
      throw new Error(`Failed to update credential: ${id}`);
    }

    this.logger.info('Credential updated successfully', { credentialId: id });
    return credential;
  }

  async delete(id: string): Promise<boolean> {
    this.logger.info('Deleting credential', { credentialId: id });

    const result = await this.repository.delete(id);

    if (result) {
      this.logger.info('Credential deleted successfully', { credentialId: id });
    }

    return result;
  }

  async getById(id: string): Promise<RetailerCredential | null> {
    return this.repository.findById(id);
  }

  async getByUserAndRetailer(
    userId: string,
    retailer: RetailerType,
  ): Promise<RetailerCredential | null> {
    return this.repository.findByUserAndRetailer(userId, retailer);
  }

  async getAllForUser(userId: string): Promise<RetailerCredential[]> {
    return this.repository.findByUserId(userId);
  }

  async validateCredential(id: string): Promise<boolean> {
    this.logger.info('Validating credential', { credentialId: id });

    const credential = await this.repository.findById(id);
    if (credential === null) {
      return false;
    }

    try {
      this.decryptPassword(credential);

      await this.repository.update(id, {
        isValid: true,
        lastValidatedAt: new Date(),
      });

      return true;
    } catch (error) {
      this.logger.error('Credential validation failed', error instanceof Error ? error : undefined, {
        requestId: id,
      });

      await this.repository.update(id, {
        isValid: false,
        lastValidatedAt: new Date(),
      });

      return false;
    }
  }

  decryptPassword(credential: RetailerCredential): string {
    return this.encryption.decrypt(credential.encryptedPassword);
  }
}

let credentialServiceInstance: CredentialService | null = null;

export function getCredentialService(): CredentialService {
  if (credentialServiceInstance === null) {
    credentialServiceInstance = new CredentialServiceImpl();
  }
  return credentialServiceInstance;
}

export { CredentialServiceImpl };
