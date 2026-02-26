import { QueryResultRow } from 'pg';

import { BaseRepository } from './base.repository.js';
import { RetailerCredential, RetailerType } from '../../types/index.js';
import { DatabaseClient } from '../database.js';

interface CredentialRow extends QueryResultRow {
  id: string;
  user_id: string;
  retailer: string;
  encrypted_username: string;
  encrypted_password: string;
  encrypted_payment_info: string | null;
  encrypted_shipping_info: string | null;
  is_valid: boolean;
  last_validated_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class CredentialRepository extends BaseRepository<RetailerCredential> {
  protected readonly tableName = 'retailer_credentials';
  protected readonly columns = [
    'id',
    'user_id',
    'retailer',
    'encrypted_username',
    'encrypted_password',
    'encrypted_payment_info',
    'encrypted_shipping_info',
    'is_valid',
    'last_validated_at',
    'expires_at',
    'created_at',
    'updated_at',
  ];

  constructor(db?: DatabaseClient) {
    super(db);
  }

  protected mapRowToEntity(row: CredentialRow): RetailerCredential {
    return {
      id: row.id,
      userId: row.user_id,
      retailer: row.retailer as RetailerType,
      encryptedUsername: row.encrypted_username,
      encryptedPassword: row.encrypted_password,
      encryptedPaymentInfo: row.encrypted_payment_info,
      encryptedShippingInfo: row.encrypted_shipping_info,
      isValid: row.is_valid,
      lastValidatedAt: row.last_validated_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected override mapEntityToRow(
    data: Partial<Omit<RetailerCredential, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (data.userId !== undefined) row.user_id = data.userId;
    if (data.retailer !== undefined) row.retailer = data.retailer;
    if (data.encryptedUsername !== undefined) row.encrypted_username = data.encryptedUsername;
    if (data.encryptedPassword !== undefined) row.encrypted_password = data.encryptedPassword;
    if (data.encryptedPaymentInfo !== undefined) row.encrypted_payment_info = data.encryptedPaymentInfo;
    if (data.encryptedShippingInfo !== undefined) row.encrypted_shipping_info = data.encryptedShippingInfo;
    if (data.isValid !== undefined) row.is_valid = data.isValid;
    if (data.lastValidatedAt !== undefined) row.last_validated_at = data.lastValidatedAt;
    if (data.expiresAt !== undefined) row.expires_at = data.expiresAt;

    return row;
  }

  async findByUserId(userId: string): Promise<RetailerCredential[]> {
    const query = `SELECT * FROM ${this.tableName} WHERE user_id = $1 ORDER BY retailer`;
    const result = await this.db.query<CredentialRow>(query, [userId]);
    return result.rows.map((row: CredentialRow) => this.mapRowToEntity(row));
  }

  async findByUserAndRetailer(userId: string, retailer: RetailerType): Promise<RetailerCredential | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE user_id = $1 AND retailer = $2`;
    const result = await this.db.query<CredentialRow>(query, [userId, retailer]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async findValidByRetailer(retailer: RetailerType): Promise<RetailerCredential[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE retailer = $1 AND is_valid = true
      AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY last_validated_at DESC NULLS LAST
    `;
    const result = await this.db.query<CredentialRow>(query, [retailer]);
    return result.rows.map((row: CredentialRow) => this.mapRowToEntity(row));
  }

  async invalidate(id: string): Promise<RetailerCredential | null> {
    const query = `
      UPDATE ${this.tableName}
      SET is_valid = false
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.db.query<CredentialRow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async validate(id: string): Promise<RetailerCredential | null> {
    const query = `
      UPDATE ${this.tableName}
      SET is_valid = true, last_validated_at = $1
      WHERE id = $2
      RETURNING *
    `;
    const result = await this.db.query<CredentialRow>(query, [new Date(), id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async findExpired(): Promise<RetailerCredential[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE expires_at IS NOT NULL AND expires_at <= NOW()
      ORDER BY expires_at
    `;
    const result = await this.db.query<CredentialRow>(query);
    return result.rows.map((row: CredentialRow) => this.mapRowToEntity(row));
  }

  async deleteByUserId(userId: string): Promise<number> {
    const query = `DELETE FROM ${this.tableName} WHERE user_id = $1`;
    const result = await this.db.query(query, [userId]);
    return result.rowCount ?? 0;
  }
}

let credentialRepositoryInstance: CredentialRepository | null = null;

export function getCredentialRepository(): CredentialRepository {
  if (credentialRepositoryInstance === null) {
    credentialRepositoryInstance = new CredentialRepository();
  }
  return credentialRepositoryInstance;
}
