import { QueryResultRow } from 'pg';

import { getDatabase, DatabaseClient } from '../database.js';
import { PaginationParams, PaginatedResponse, Identifiable, Timestamps } from '../../types/index.js';

export interface Repository<T extends Identifiable> {
  findById(id: string): Promise<T | null>;
  findAll(pagination?: PaginationParams): Promise<PaginatedResponse<T>>;
  create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;
  update(id: string, data: Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  count(where?: Record<string, unknown>): Promise<number>;
}

export abstract class BaseRepository<T extends Identifiable & Timestamps> implements Repository<T> {
  protected readonly db: DatabaseClient;
  protected abstract readonly tableName: string;
  protected abstract readonly columns: string[];

  constructor(db?: DatabaseClient) {
    this.db = db ?? getDatabase();
  }

  protected abstract mapRowToEntity(row: QueryResultRow): T;

  protected mapEntityToRow(
    data: Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    return data as Record<string, unknown>;
  }

  protected buildWhereClause(
    conditions: Record<string, unknown>,
    startIndex: number = 1,
  ): { clause: string; values: unknown[]; nextIndex: number } {
    const entries = Object.entries(conditions).filter(([_, v]) => v !== undefined);

    if (entries.length === 0) {
      return { clause: '', values: [], nextIndex: startIndex };
    }

    const clauses: string[] = [];
    const values: unknown[] = [];
    let index = startIndex;

    for (const [key, value] of entries) {
      const snakeKey = this.camelToSnake(key);

      if (value === null) {
        clauses.push(`${snakeKey} IS NULL`);
      } else if (Array.isArray(value)) {
        const placeholders = value.map((_, i) => `$${index + i}`).join(', ');
        clauses.push(`${snakeKey} IN (${placeholders})`);
        values.push(...value);
        index += value.length;
      } else {
        clauses.push(`${snakeKey} = $${index}`);
        values.push(value);
        index++;
      }
    }

    return {
      clause: `WHERE ${clauses.join(' AND ')}`,
      values,
      nextIndex: index,
    };
  }

  protected camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  protected snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  }

  async findById(id: string): Promise<T | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
    const result = await this.db.query<QueryResultRow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async findAll(pagination?: PaginationParams): Promise<PaginatedResponse<T>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const offset = (page - 1) * limit;
    const sortBy = pagination?.sortBy ? this.camelToSnake(pagination.sortBy) : 'created_at';
    const sortOrder = pagination?.sortOrder ?? 'desc';

    const countQuery = `SELECT COUNT(*) as count FROM ${this.tableName}`;
    const countResult = await this.db.query<{ count: string }>(countQuery);
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const dataQuery = `
      SELECT * FROM ${this.tableName}
      ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
      LIMIT $1 OFFSET $2
    `;
    const dataResult = await this.db.query<QueryResultRow>(dataQuery, [limit, offset]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult.rows.map((row: QueryResultRow) => this.mapRowToEntity(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T> {
    const row = this.mapEntityToRow(data);
    const entries = Object.entries(row).filter(([_, v]) => v !== undefined);
    const columns = entries.map(([k]) => this.camelToSnake(k));
    const values = entries.map(([_, v]) => v);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const query = `
      INSERT INTO ${this.tableName} (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const result = await this.db.query<QueryResultRow>(query, values);

    if (result.rows.length === 0) {
      throw new Error('Failed to create entity');
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async update(
    id: string,
    data: Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<T | null> {
    const row = this.mapEntityToRow(data);
    const entries = Object.entries(row).filter(([_, v]) => v !== undefined);

    if (entries.length === 0) {
      return this.findById(id);
    }

    const setClauses = entries.map(([k], i) => `${this.camelToSnake(k)} = $${i + 1}`);
    const values = [...entries.map(([_, v]) => v), id];

    const query = `
      UPDATE ${this.tableName}
      SET ${setClauses.join(', ')}
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await this.db.query<QueryResultRow>(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
    const result = await this.db.query(query, [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async count(where?: Record<string, unknown>): Promise<number> {
    let query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
    let values: unknown[] = [];

    if (where !== undefined && Object.keys(where).length > 0) {
      const { clause, values: whereValues } = this.buildWhereClause(where);
      query += ` ${clause}`;
      values = whereValues;
    }

    const result = await this.db.query<{ count: string }>(query, values);
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async exists(id: string): Promise<boolean> {
    const query = `SELECT EXISTS(SELECT 1 FROM ${this.tableName} WHERE id = $1) as exists`;
    const result = await this.db.query<{ exists: boolean }>(query, [id]);
    return result.rows[0]?.exists ?? false;
  }

  async findWhere(
    conditions: Record<string, unknown>,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<T>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const offset = (page - 1) * limit;
    const sortBy = pagination?.sortBy ? this.camelToSnake(pagination.sortBy) : 'created_at';
    const sortOrder = pagination?.sortOrder ?? 'desc';

    const { clause: whereClause, values: whereValues, nextIndex } = this.buildWhereClause(conditions);

    const countQuery = `SELECT COUNT(*) as count FROM ${this.tableName} ${whereClause}`;
    const countResult = await this.db.query<{ count: string }>(countQuery, whereValues);
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const dataQuery = `
      SELECT * FROM ${this.tableName}
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
      LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
    `;
    const dataResult = await this.db.query<QueryResultRow>(dataQuery, [...whereValues, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult.rows.map((row: QueryResultRow) => this.mapRowToEntity(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async findOneWhere(conditions: Record<string, unknown>): Promise<T | null> {
    const { clause, values } = this.buildWhereClause(conditions);
    const query = `SELECT * FROM ${this.tableName} ${clause} LIMIT 1`;
    const result = await this.db.query<QueryResultRow>(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }
}
