import { QueryResultRow } from 'pg';

import { BaseRepository } from './base.repository.js';
import {
  SKU,
  SKUMetadata,
  StockStatus,
  MonitoringStatus,
  RetailerType,
  PaginationParams,
  PaginatedResponse,
} from '../../types/index.js';
import { DatabaseClient } from '../database.js';

interface SKURow extends QueryResultRow {
  id: string;
  retailer: string;
  product_id: string;
  product_url: string;
  product_name: string;
  target_price: string | null;
  current_price: string | null;
  current_stock_status: string;
  monitoring_status: string;
  auto_checkout_enabled: boolean;
  polling_interval_ms: number;
  last_checked_at: Date | null;
  last_stock_change_at: Date | null;
  consecutive_errors: number;
  metadata: SKUMetadata;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export class SKURepository extends BaseRepository<SKU> {
  protected readonly tableName = 'skus';
  protected readonly columns = [
    'id',
    'retailer',
    'product_id',
    'product_url',
    'product_name',
    'target_price',
    'current_price',
    'current_stock_status',
    'monitoring_status',
    'auto_checkout_enabled',
    'polling_interval_ms',
    'last_checked_at',
    'last_stock_change_at',
    'consecutive_errors',
    'metadata',
    'created_at',
    'updated_at',
    'deleted_at',
  ];

  constructor(db?: DatabaseClient) {
    super(db);
  }

  protected mapRowToEntity(row: SKURow): SKU {
    return {
      id: row.id,
      retailer: row.retailer as RetailerType,
      productId: row.product_id,
      productUrl: row.product_url,
      productName: row.product_name,
      targetPrice: row.target_price !== null ? parseFloat(row.target_price) : null,
      currentPrice: row.current_price !== null ? parseFloat(row.current_price) : null,
      currentStockStatus: row.current_stock_status as StockStatus,
      monitoringStatus: row.monitoring_status as MonitoringStatus,
      autoCheckoutEnabled: row.auto_checkout_enabled,
      pollingIntervalMs: row.polling_interval_ms,
      lastCheckedAt: row.last_checked_at,
      lastStockChangeAt: row.last_stock_change_at,
      consecutiveErrors: row.consecutive_errors,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  protected override mapEntityToRow(
    data: Partial<Omit<SKU, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (data.retailer !== undefined) row.retailer = data.retailer;
    if (data.productId !== undefined) row.product_id = data.productId;
    if (data.productUrl !== undefined) row.product_url = data.productUrl;
    if (data.productName !== undefined) row.product_name = data.productName;
    if (data.targetPrice !== undefined) row.target_price = data.targetPrice;
    if (data.currentPrice !== undefined) row.current_price = data.currentPrice;
    if (data.currentStockStatus !== undefined) row.current_stock_status = data.currentStockStatus;
    if (data.monitoringStatus !== undefined) row.monitoring_status = data.monitoringStatus;
    if (data.autoCheckoutEnabled !== undefined) row.auto_checkout_enabled = data.autoCheckoutEnabled;
    if (data.pollingIntervalMs !== undefined) row.polling_interval_ms = data.pollingIntervalMs;
    if (data.lastCheckedAt !== undefined) row.last_checked_at = data.lastCheckedAt;
    if (data.lastStockChangeAt !== undefined) row.last_stock_change_at = data.lastStockChangeAt;
    if (data.consecutiveErrors !== undefined) row.consecutive_errors = data.consecutiveErrors;
    if (data.metadata !== undefined) row.metadata = JSON.stringify(data.metadata);
    if (data.deletedAt !== undefined) row.deleted_at = data.deletedAt;

    return row;
  }

  async findById(id: string): Promise<SKU | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE id = $1 AND deleted_at IS NULL`;
    const result = await this.db.query<SKURow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async findAll(pagination?: PaginationParams): Promise<PaginatedResponse<SKU>> {
    return this.findWhere({ deletedAt: null }, pagination);
  }

  override async findWhere(
    conditions: Record<string, unknown>,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<SKU>> {
    const safeConditions = { ...conditions };

    if (!('deletedAt' in safeConditions)) {
      safeConditions.deleted_at = null;
    } else if (safeConditions.deletedAt === null) {
      delete safeConditions.deletedAt;
      safeConditions.deleted_at = null;
    }

    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const offset = (page - 1) * limit;
    const sortBy = pagination?.sortBy ? this.camelToSnake(pagination.sortBy) : 'created_at';
    const sortOrder = pagination?.sortOrder ?? 'desc';

    const { clause: whereClause, values: whereValues, nextIndex } = this.buildWhereClause(safeConditions);

    const countQuery = `SELECT COUNT(*) as count FROM ${this.tableName} ${whereClause}`;
    const countResult = await this.db.query<{ count: string }>(countQuery, whereValues);
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const dataQuery = `
      SELECT * FROM ${this.tableName}
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
      LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
    `;
    const dataResult = await this.db.query<SKURow>(dataQuery, [...whereValues, limit, offset]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult.rows.map((row: SKURow) => this.mapRowToEntity(row)),
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

  async findByRetailerAndProductId(retailer: RetailerType, productId: string): Promise<SKU | null> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE retailer = $1 AND product_id = $2 AND deleted_at IS NULL
    `;
    const result = await this.db.query<SKURow>(query, [retailer, productId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async findActiveForMonitoring(): Promise<SKU[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE monitoring_status = $1 AND deleted_at IS NULL
      ORDER BY last_checked_at ASC NULLS FIRST
    `;
    const result = await this.db.query<SKURow>(query, [MonitoringStatus.ACTIVE]);
    return result.rows.map((row: SKURow) => this.mapRowToEntity(row));
  }

  async findByMonitoringStatus(status: MonitoringStatus): Promise<SKU[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE monitoring_status = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    const result = await this.db.query<SKURow>(query, [status]);
    return result.rows.map((row: SKURow) => this.mapRowToEntity(row));
  }

  async findByRetailer(retailer: RetailerType): Promise<SKU[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE retailer = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    const result = await this.db.query<SKURow>(query, [retailer]);
    return result.rows.map((row: SKURow) => this.mapRowToEntity(row));
  }

  async updateStockStatus(
    id: string,
    stockStatus: StockStatus,
    price: number | null,
  ): Promise<SKU | null> {
    const now = new Date();
    const query = `
      UPDATE ${this.tableName}
      SET current_stock_status = $1,
          current_price = $2,
          last_checked_at = $3,
          last_stock_change_at = CASE WHEN current_stock_status != $1 THEN $3 ELSE last_stock_change_at END,
          consecutive_errors = 0
      WHERE id = $4 AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await this.db.query<SKURow>(query, [stockStatus, price, now, id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async incrementErrorCount(id: string): Promise<SKU | null> {
    const query = `
      UPDATE ${this.tableName}
      SET consecutive_errors = consecutive_errors + 1,
          last_checked_at = $1
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await this.db.query<SKURow>(query, [new Date(), id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async resetErrorCount(id: string): Promise<SKU | null> {
    const query = `
      UPDATE ${this.tableName}
      SET consecutive_errors = 0
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await this.db.query<SKURow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async softDelete(id: string): Promise<boolean> {
    const query = `
      UPDATE ${this.tableName}
      SET deleted_at = $1, monitoring_status = $2
      WHERE id = $3 AND deleted_at IS NULL
    `;
    const result = await this.db.query(query, [new Date(), MonitoringStatus.STOPPED, id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async restore(id: string): Promise<SKU | null> {
    const query = `
      UPDATE ${this.tableName}
      SET deleted_at = NULL
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING *
    `;
    const result = await this.db.query<SKURow>(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async getStatistics(): Promise<{
    total: number;
    active: number;
    paused: number;
    stopped: number;
    inStock: number;
    outOfStock: number;
    withAutoCheckout: number;
  }> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) as total,
        COUNT(*) FILTER (WHERE monitoring_status = 'ACTIVE' AND deleted_at IS NULL) as active,
        COUNT(*) FILTER (WHERE monitoring_status = 'PAUSED' AND deleted_at IS NULL) as paused,
        COUNT(*) FILTER (WHERE monitoring_status = 'STOPPED' AND deleted_at IS NULL) as stopped,
        COUNT(*) FILTER (WHERE current_stock_status = 'IN_STOCK' AND deleted_at IS NULL) as in_stock,
        COUNT(*) FILTER (WHERE current_stock_status = 'OUT_OF_STOCK' AND deleted_at IS NULL) as out_of_stock,
        COUNT(*) FILTER (WHERE auto_checkout_enabled = true AND deleted_at IS NULL) as with_auto_checkout
      FROM ${this.tableName}
    `;
    const result = await this.db.query<{
      total: string;
      active: string;
      paused: string;
      stopped: string;
      in_stock: string;
      out_of_stock: string;
      with_auto_checkout: string;
    }>(query);

    const row = result.rows[0];

    return {
      total: parseInt(row?.total ?? '0', 10),
      active: parseInt(row?.active ?? '0', 10),
      paused: parseInt(row?.paused ?? '0', 10),
      stopped: parseInt(row?.stopped ?? '0', 10),
      inStock: parseInt(row?.in_stock ?? '0', 10),
      outOfStock: parseInt(row?.out_of_stock ?? '0', 10),
      withAutoCheckout: parseInt(row?.with_auto_checkout ?? '0', 10),
    };
  }
}

let skuRepositoryInstance: SKURepository | null = null;

export function getSKURepository(): SKURepository {
  if (skuRepositoryInstance === null) {
    skuRepositoryInstance = new SKURepository();
  }
  return skuRepositoryInstance;
}
