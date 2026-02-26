import { QueryResultRow } from 'pg';

import { BaseRepository } from './base.repository.js';
import { User, UserRole } from '../../types/index.js';
import { DatabaseClient } from '../database.js';

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  role: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class UserRepository extends BaseRepository<User> {
  protected readonly tableName = 'users';
  protected readonly columns = [
    'id',
    'email',
    'name',
    'password_hash',
    'role',
    'is_active',
    'last_login_at',
    'created_at',
    'updated_at',
  ];

  constructor(db?: DatabaseClient) {
    super(db);
  }

  protected mapRowToEntity(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name ?? undefined,
      passwordHash: row.password_hash,
      role: row.role as UserRole,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected override mapEntityToRow(
    data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (data.email !== undefined) row.email = data.email;
    if (data.name !== undefined) row.name = data.name;
    if (data.passwordHash !== undefined) row.password_hash = data.passwordHash;
    if (data.role !== undefined) row.role = data.role;
    if (data.isActive !== undefined) row.is_active = data.isActive;
    if (data.lastLoginAt !== undefined) row.last_login_at = data.lastLoginAt;

    return row;
  }

  async findByEmail(email: string): Promise<User | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE email = $1`;
    const result = await this.db.query<UserRow>(query, [email.toLowerCase()]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async findActiveUsers(): Promise<User[]> {
    const query = `SELECT * FROM ${this.tableName} WHERE is_active = true ORDER BY created_at DESC`;
    const result = await this.db.query<UserRow>(query);
    return result.rows.map((row: UserRow) => this.mapRowToEntity(row));
  }

  async findByRole(role: UserRole): Promise<User[]> {
    const query = `SELECT * FROM ${this.tableName} WHERE role = $1 ORDER BY created_at DESC`;
    const result = await this.db.query<UserRow>(query, [role]);
    return result.rows.map((row: UserRow) => this.mapRowToEntity(row));
  }

  async updateLastLogin(id: string): Promise<User | null> {
    const query = `
      UPDATE ${this.tableName}
      SET last_login_at = $1
      WHERE id = $2
      RETURNING *
    `;
    const result = await this.db.query<UserRow>(query, [new Date(), id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async deactivate(id: string): Promise<User | null> {
    const query = `
      UPDATE ${this.tableName}
      SET is_active = false
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.db.query<UserRow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async activate(id: string): Promise<User | null> {
    const query = `
      UPDATE ${this.tableName}
      SET is_active = true
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.db.query<UserRow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async updatePassword(id: string, passwordHash: string): Promise<User | null> {
    const query = `
      UPDATE ${this.tableName}
      SET password_hash = $1
      WHERE id = $2
      RETURNING *
    `;
    const result = await this.db.query<UserRow>(query, [passwordHash, id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async emailExists(email: string): Promise<boolean> {
    const query = `SELECT EXISTS(SELECT 1 FROM ${this.tableName} WHERE email = $1) as exists`;
    const result = await this.db.query<{ exists: boolean }>(query, [email.toLowerCase()]);
    return result.rows[0]?.exists ?? false;
  }

  override async create(
    data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<User> {
    const normalizedData = {
      ...data,
      email: data.email.toLowerCase(),
    };
    return super.create(normalizedData);
  }
}

let userRepositoryInstance: UserRepository | null = null;

export function getUserRepository(): UserRepository {
  if (userRepositoryInstance === null) {
    userRepositoryInstance = new UserRepository();
  }
  return userRepositoryInstance;
}
