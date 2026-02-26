import { QueryResultRow } from 'pg';

import { BaseRepository } from './base.repository.js';
import { Alert, AlertType, ErrorSeverity } from '../../types/index.js';
import { DatabaseClient } from '../database.js';

interface AlertRow extends QueryResultRow {
  id: string;
  type: string;
  sku_id: string | null;
  title: string;
  message: string;
  severity: string;
  is_read: boolean;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class AlertRepository extends BaseRepository<Alert> {
  protected readonly tableName = 'alerts';
  protected readonly columns = [
    'id',
    'type',
    'sku_id',
    'title',
    'message',
    'severity',
    'is_read',
    'acknowledged_at',
    'acknowledged_by',
    'metadata',
    'created_at',
    'updated_at',
  ];

  constructor(db?: DatabaseClient) {
    super(db);
  }

  protected mapRowToEntity(row: AlertRow): Alert {
    return {
      id: row.id,
      type: row.type as AlertType,
      skuId: row.sku_id,
      title: row.title,
      message: row.message,
      severity: row.severity as ErrorSeverity,
      isRead: row.is_read,
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected override mapEntityToRow(
    data: Partial<Omit<Alert, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (data.type !== undefined) row.type = data.type;
    if (data.skuId !== undefined) row.sku_id = data.skuId;
    if (data.title !== undefined) row.title = data.title;
    if (data.message !== undefined) row.message = data.message;
    if (data.severity !== undefined) row.severity = data.severity;
    if (data.isRead !== undefined) row.is_read = data.isRead;
    if (data.acknowledgedAt !== undefined) row.acknowledged_at = data.acknowledgedAt;
    if (data.acknowledgedBy !== undefined) row.acknowledged_by = data.acknowledgedBy;
    if (data.metadata !== undefined) row.metadata = JSON.stringify(data.metadata);

    return row;
  }

  async findUnread(limit?: number): Promise<Alert[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE is_read = false
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [];

    if (limit !== undefined) {
      query += ' LIMIT $1';
      params.push(limit);
    }

    const result = await this.db.query<AlertRow>(query, params);
    return result.rows.map((row: AlertRow) => this.mapRowToEntity(row));
  }

  async findBySKU(skuId: string, limit?: number): Promise<Alert[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE sku_id = $1
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [skuId];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<AlertRow>(query, params);
    return result.rows.map((row: AlertRow) => this.mapRowToEntity(row));
  }

  async findByType(type: AlertType, limit?: number): Promise<Alert[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE type = $1
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [type];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<AlertRow>(query, params);
    return result.rows.map((row: AlertRow) => this.mapRowToEntity(row));
  }

  async findBySeverity(severity: ErrorSeverity, limit?: number): Promise<Alert[]> {
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

    const result = await this.db.query<AlertRow>(query, params);
    return result.rows.map((row: AlertRow) => this.mapRowToEntity(row));
  }

  async markAsRead(id: string): Promise<Alert | null> {
    const query = `
      UPDATE ${this.tableName}
      SET is_read = true
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.db.query<AlertRow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async markAllAsRead(): Promise<number> {
    const query = `
      UPDATE ${this.tableName}
      SET is_read = true
      WHERE is_read = false
    `;
    const result = await this.db.query(query);
    return result.rowCount ?? 0;
  }

  async acknowledge(id: string, userId: string): Promise<Alert | null> {
    const query = `
      UPDATE ${this.tableName}
      SET acknowledged_at = $1, acknowledged_by = $2, is_read = true
      WHERE id = $3
      RETURNING *
    `;
    const result = await this.db.query<AlertRow>(query, [new Date(), userId, id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async getUnreadCount(): Promise<number> {
    const query = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE is_read = false`;
    const result = await this.db.query<{ count: string }>(query);
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async findUnacknowledged(limit?: number): Promise<Alert[]> {
    return this.findUnread(limit);
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    pagination?: { page?: number; limit?: number },
  ): Promise<{ data: Alert[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean } }> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const offset = (page - 1) * limit;

    const countQuery = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE created_at >= $1 AND created_at <= $2`;
    const countResult = await this.db.query<{ count: string }>(countQuery, [startDate, endDate]);
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const query = `
      SELECT * FROM ${this.tableName}
      WHERE created_at >= $1 AND created_at <= $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `;
    const result = await this.db.query<AlertRow>(query, [startDate, endDate, limit, offset]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: result.rows.map((row: AlertRow) => this.mapRowToEntity(row)),
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

  async acknowledgeAll(skuId?: string): Promise<number> {
    let query: string;
    let params: unknown[];

    if (skuId !== undefined) {
      query = `
        UPDATE ${this.tableName}
        SET acknowledged_at = $1, acknowledged_by = 'system', is_read = true
        WHERE acknowledged_at IS NULL AND sku_id = $2
      `;
      params = [new Date(), skuId];
    } else {
      query = `
        UPDATE ${this.tableName}
        SET acknowledged_at = $1, acknowledged_by = 'system', is_read = true
        WHERE acknowledged_at IS NULL
      `;
      params = [new Date()];
    }

    const result = await this.db.query(query, params);
    return result.rowCount ?? 0;
  }

  async cleanupOldAlerts(days: number = 30): Promise<number> {
    const query = `
      DELETE FROM ${this.tableName}
      WHERE created_at < NOW() - INTERVAL '${days} days'
      AND is_read = true
    `;
    const result = await this.db.query(query);
    return result.rowCount ?? 0;
  }
}

let alertRepositoryInstance: AlertRepository | null = null;

export function getAlertRepository(): AlertRepository {
  if (alertRepositoryInstance === null) {
    alertRepositoryInstance = new AlertRepository();
  }
  return alertRepositoryInstance;
}
