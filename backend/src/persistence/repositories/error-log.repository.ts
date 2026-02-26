import { QueryResultRow } from 'pg';

import { BaseRepository } from './base.repository.js';
import { ErrorLog, ErrorCategory, ErrorSeverity, ErrorContext } from '../../types/index.js';
import { DatabaseClient } from '../database.js';

interface ErrorLogRow extends QueryResultRow {
  id: string;
  category: string;
  severity: string;
  message: string;
  stack: string | null;
  context: ErrorContext;
  resolved: boolean;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ErrorLogRepository extends BaseRepository<ErrorLog> {
  protected readonly tableName = 'error_logs';
  protected readonly columns = [
    'id',
    'category',
    'severity',
    'message',
    'stack',
    'context',
    'resolved',
    'resolved_at',
    'resolved_by',
    'created_at',
    'updated_at',
  ];

  constructor(db?: DatabaseClient) {
    super(db);
  }

  protected mapRowToEntity(row: ErrorLogRow): ErrorLog {
    return {
      id: row.id,
      category: row.category as ErrorCategory,
      severity: row.severity as ErrorSeverity,
      message: row.message,
      stack: row.stack,
      context: row.context,
      resolved: row.resolved,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected override mapEntityToRow(
    data: Partial<Omit<ErrorLog, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (data.category !== undefined) row.category = data.category;
    if (data.severity !== undefined) row.severity = data.severity;
    if (data.message !== undefined) row.message = data.message;
    if (data.stack !== undefined) row.stack = data.stack;
    if (data.context !== undefined) row.context = JSON.stringify(data.context);
    if (data.resolved !== undefined) row.resolved = data.resolved;
    if (data.resolvedAt !== undefined) row.resolved_at = data.resolvedAt;
    if (data.resolvedBy !== undefined) row.resolved_by = data.resolvedBy;

    return row;
  }

  async findUnresolved(limit?: number): Promise<ErrorLog[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE resolved = false
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [];

    if (limit !== undefined) {
      query += ' LIMIT $1';
      params.push(limit);
    }

    const result = await this.db.query<ErrorLogRow>(query, params);
    return result.rows.map((row: ErrorLogRow) => this.mapRowToEntity(row));
  }

  async findByCategory(category: ErrorCategory, limit?: number): Promise<ErrorLog[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE category = $1
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [category];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<ErrorLogRow>(query, params);
    return result.rows.map((row: ErrorLogRow) => this.mapRowToEntity(row));
  }

  async findBySeverity(severity: ErrorSeverity, limit?: number): Promise<ErrorLog[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE severity = $1
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [severity];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<ErrorLogRow>(query, params);
    return result.rows.map((row: ErrorLogRow) => this.mapRowToEntity(row));
  }

  async findBySKU(skuId: string, limit?: number): Promise<ErrorLog[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE context->>'skuId' = $1
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [skuId];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<ErrorLogRow>(query, params);
    return result.rows.map((row: ErrorLogRow) => this.mapRowToEntity(row));
  }

  async resolve(id: string, userId: string): Promise<ErrorLog | null> {
    const query = `
      UPDATE ${this.tableName}
      SET resolved = true, resolved_at = $1, resolved_by = $2
      WHERE id = $3
      RETURNING *
    `;
    const result = await this.db.query<ErrorLogRow>(query, [new Date(), userId, id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async getErrorCounts(hours: number = 24): Promise<Record<ErrorCategory, number>> {
    const query = `
      SELECT category, COUNT(*) as count
      FROM ${this.tableName}
      WHERE created_at >= NOW() - INTERVAL '${hours} hours'
      GROUP BY category
    `;
    const result = await this.db.query<{ category: string; count: string }>(query);

    const counts: Record<ErrorCategory, number> = {} as Record<ErrorCategory, number>;
    for (const category of Object.values(ErrorCategory)) {
      counts[category] = 0;
    }

    for (const row of result.rows) {
      counts[row.category as ErrorCategory] = parseInt(row.count, 10);
    }

    return counts;
  }

  async getUnresolvedCount(): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE resolved = false`;
    const result = await this.db.query<{ count: string }>(query);
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async cleanupOldErrors(days: number = 90): Promise<number> {
    const query = `
      DELETE FROM ${this.tableName}
      WHERE created_at < NOW() - INTERVAL '${days} days'
      AND resolved = true
    `;
    const result = await this.db.query(query);
    return result.rowCount ?? 0;
  }
}

let errorLogRepositoryInstance: ErrorLogRepository | null = null;

export function getErrorLogRepository(): ErrorLogRepository {
  if (errorLogRepositoryInstance === null) {
    errorLogRepositoryInstance = new ErrorLogRepository();
  }
  return errorLogRepositoryInstance;
}
