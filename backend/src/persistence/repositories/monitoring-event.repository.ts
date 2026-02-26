import { QueryResultRow } from 'pg';

import { BaseRepository } from './base.repository.js';
import { MonitoringEvent, StockStatus, ErrorCategory } from '../../types/index.js';
import { DatabaseClient } from '../database.js';

interface MonitoringEventRow extends QueryResultRow {
  id: string;
  sku_id: string;
  event_type: string;
  previous_stock_status: string | null;
  new_stock_status: string | null;
  previous_price: string | null;
  new_price: string | null;
  error_category: string | null;
  error_message: string | null;
  response_time_ms: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class MonitoringEventRepository extends BaseRepository<MonitoringEvent> {
  protected readonly tableName = 'monitoring_events';
  protected readonly columns = [
    'id',
    'sku_id',
    'event_type',
    'previous_stock_status',
    'new_stock_status',
    'previous_price',
    'new_price',
    'error_category',
    'error_message',
    'response_time_ms',
    'metadata',
    'created_at',
    'updated_at',
  ];

  constructor(db?: DatabaseClient) {
    super(db);
  }

  protected mapRowToEntity(row: MonitoringEventRow): MonitoringEvent {
    return {
      id: row.id,
      skuId: row.sku_id,
      eventType: row.event_type as 'CHECK' | 'STOCK_CHANGE' | 'PRICE_CHANGE' | 'ERROR',
      previousStockStatus: row.previous_stock_status as StockStatus | null,
      newStockStatus: row.new_stock_status as StockStatus | null,
      previousPrice: row.previous_price !== null ? parseFloat(row.previous_price) : null,
      newPrice: row.new_price !== null ? parseFloat(row.new_price) : null,
      errorCategory: row.error_category as ErrorCategory | null,
      errorMessage: row.error_message,
      responseTimeMs: row.response_time_ms,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected override mapEntityToRow(
    data: Partial<Omit<MonitoringEvent, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (data.skuId !== undefined) row.sku_id = data.skuId;
    if (data.eventType !== undefined) row.event_type = data.eventType;
    if (data.previousStockStatus !== undefined) row.previous_stock_status = data.previousStockStatus;
    if (data.newStockStatus !== undefined) row.new_stock_status = data.newStockStatus;
    if (data.previousPrice !== undefined) row.previous_price = data.previousPrice;
    if (data.newPrice !== undefined) row.new_price = data.newPrice;
    if (data.errorCategory !== undefined) row.error_category = data.errorCategory;
    if (data.errorMessage !== undefined) row.error_message = data.errorMessage;
    if (data.responseTimeMs !== undefined) row.response_time_ms = data.responseTimeMs;
    if (data.metadata !== undefined) row.metadata = JSON.stringify(data.metadata);

    return row;
  }

  async findBySKU(skuId: string, limit?: number): Promise<MonitoringEvent[]> {
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

    const result = await this.db.query<MonitoringEventRow>(query, params);
    return result.rows.map((row: MonitoringEventRow) => this.mapRowToEntity(row));
  }

  async findByEventType(
    eventType: 'CHECK' | 'STOCK_CHANGE' | 'PRICE_CHANGE' | 'ERROR',
    limit?: number,
  ): Promise<MonitoringEvent[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE event_type = $1
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [eventType];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<MonitoringEventRow>(query, params);
    return result.rows.map((row: MonitoringEventRow) => this.mapRowToEntity(row));
  }

  async findErrors(hours: number = 24, limit?: number): Promise<MonitoringEvent[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE event_type = 'ERROR' AND created_at >= NOW() - INTERVAL '${hours} hours'
      ORDER BY created_at DESC
    `;

    const params: unknown[] = [];

    if (limit !== undefined) {
      query += ' LIMIT $1';
      params.push(limit);
    }

    const result = await this.db.query<MonitoringEventRow>(query, params);
    return result.rows.map((row: MonitoringEventRow) => this.mapRowToEntity(row));
  }

  async findStockChanges(hours: number = 24): Promise<MonitoringEvent[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE event_type = 'STOCK_CHANGE' AND created_at >= NOW() - INTERVAL '${hours} hours'
      ORDER BY created_at DESC
    `;
    const result = await this.db.query<MonitoringEventRow>(query);
    return result.rows.map((row: MonitoringEventRow) => this.mapRowToEntity(row));
  }

  async getStatistics(hours: number = 24): Promise<{
    totalChecks: number;
    stockChanges: number;
    priceChanges: number;
    errors: number;
    averageResponseTimeMs: number;
  }> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'CHECK') as total_checks,
        COUNT(*) FILTER (WHERE event_type = 'STOCK_CHANGE') as stock_changes,
        COUNT(*) FILTER (WHERE event_type = 'PRICE_CHANGE') as price_changes,
        COUNT(*) FILTER (WHERE event_type = 'ERROR') as errors,
        AVG(response_time_ms) as avg_response_time_ms
      FROM ${this.tableName}
      WHERE created_at >= NOW() - INTERVAL '${hours} hours'
    `;
    const result = await this.db.query<{
      total_checks: string;
      stock_changes: string;
      price_changes: string;
      errors: string;
      avg_response_time_ms: string | null;
    }>(query);

    const row = result.rows[0];

    return {
      totalChecks: parseInt(row?.total_checks ?? '0', 10),
      stockChanges: parseInt(row?.stock_changes ?? '0', 10),
      priceChanges: parseInt(row?.price_changes ?? '0', 10),
      errors: parseInt(row?.errors ?? '0', 10),
      averageResponseTimeMs: row?.avg_response_time_ms !== null 
        ? parseFloat(row?.avg_response_time_ms ?? '0') 
        : 0,
    };
  }

  async cleanupOldEvents(days: number = 30): Promise<number> {
    const query = `
      DELETE FROM ${this.tableName}
      WHERE created_at < NOW() - INTERVAL '${days} days'
      AND event_type = 'CHECK'
    `;
    const result = await this.db.query(query);
    return result.rowCount ?? 0;
  }

  async getAverageResponseTime(skuId: string, hours: number = 24): Promise<number> {
    const query = `
      SELECT AVG(response_time_ms) as avg_response_time_ms
      FROM ${this.tableName}
      WHERE sku_id = $1 AND created_at >= NOW() - INTERVAL '${hours} hours'
    `;
    const result = await this.db.query<{ avg_response_time_ms: string | null }>(query, [skuId]);

    const avgStr = result.rows[0]?.avg_response_time_ms;
    return avgStr !== null ? parseFloat(avgStr ?? '0') : 0;
  }
}

let monitoringEventRepositoryInstance: MonitoringEventRepository | null = null;

export function getMonitoringEventRepository(): MonitoringEventRepository {
  if (monitoringEventRepositoryInstance === null) {
    monitoringEventRepositoryInstance = new MonitoringEventRepository();
  }
  return monitoringEventRepositoryInstance;
}
