import { QueryResultRow } from 'pg';

import { BaseRepository } from './base.repository.js';
import { CheckoutAttempt, CheckoutStatus, CheckoutStepRecord, ErrorCategory } from '../../types/index.js';
import { DatabaseClient } from '../database.js';

interface CheckoutAttemptRow extends QueryResultRow {
  id: string;
  sku_id: string;
  user_id: string | null;
  credential_id: string | null;
  status: string;
  started_at: Date;
  completed_at: Date | null;
  failure_reason: string | null;
  error_category: string | null;
  current_step: string | null;
  step_history: CheckoutStepRecord[] | null;
  order_number: string | null;
  total_price: string | null;
  created_at: Date;
  updated_at: Date;
}

export class CheckoutAttemptRepository extends BaseRepository<CheckoutAttempt> {
  protected readonly tableName = 'checkout_attempts';
  protected readonly columns = [
    'id',
    'sku_id',
    'user_id',
    'credential_id',
    'status',
    'started_at',
    'completed_at',
    'failure_reason',
    'error_category',
    'current_step',
    'step_history',
    'order_number',
    'total_price',
    'created_at',
    'updated_at',
  ];

  constructor(db?: DatabaseClient) {
    super(db);
  }

  protected mapRowToEntity(row: CheckoutAttemptRow): CheckoutAttempt {
    return {
      id: row.id,
      skuId: row.sku_id,
      userId: row.user_id ?? undefined,
      credentialId: row.credential_id ?? '',
      status: row.status as CheckoutStatus,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      failureReason: row.failure_reason,
      errorCategory: row.error_category as ErrorCategory | null,
      currentStep: row.current_step ?? '',
      stepHistory: row.step_history ?? [],
      orderNumber: row.order_number,
      totalPrice: row.total_price !== null ? parseFloat(row.total_price) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected override mapEntityToRow(
    data: Partial<Omit<CheckoutAttempt, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (data.skuId !== undefined) row.sku_id = data.skuId;
    if (data.userId !== undefined) row.user_id = data.userId;
    if (data.credentialId !== undefined) row.credential_id = data.credentialId;
    if (data.status !== undefined) row.status = data.status;
    if (data.startedAt !== undefined) row.started_at = data.startedAt;
    if (data.completedAt !== undefined) row.completed_at = data.completedAt;
    if (data.failureReason !== undefined) row.failure_reason = data.failureReason;
    if (data.errorCategory !== undefined) row.error_category = data.errorCategory;
    if (data.currentStep !== undefined) row.current_step = data.currentStep;
    if (data.stepHistory !== undefined) row.step_history = JSON.stringify(data.stepHistory);
    if (data.orderNumber !== undefined) row.order_number = data.orderNumber;
    if (data.totalPrice !== undefined) row.total_price = data.totalPrice;

    return row;
  }

  async findBySKU(skuId: string, limit?: number): Promise<CheckoutAttempt[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE sku_id = $1
      ORDER BY started_at DESC
    `;

    const params: unknown[] = [skuId];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<CheckoutAttemptRow>(query, params);
    return result.rows.map((row: CheckoutAttemptRow) => this.mapRowToEntity(row));
  }

  async findByCredential(credentialId: string, limit?: number): Promise<CheckoutAttempt[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE credential_id = $1
      ORDER BY started_at DESC
    `;

    const params: unknown[] = [credentialId];

    if (limit !== undefined) {
      query += ' LIMIT $2';
      params.push(limit);
    }

    const result = await this.db.query<CheckoutAttemptRow>(query, params);
    return result.rows.map((row: CheckoutAttemptRow) => this.mapRowToEntity(row));
  }

  async findByStatus(status: CheckoutStatus): Promise<CheckoutAttempt[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE status = $1
      ORDER BY started_at DESC
    `;
    const result = await this.db.query<CheckoutAttemptRow>(query, [status]);
    return result.rows.map((row: CheckoutAttemptRow) => this.mapRowToEntity(row));
  }

  async findActiveAttempts(): Promise<CheckoutAttempt[]> {
    const activeStatuses = [
      CheckoutStatus.INITIATED,
      CheckoutStatus.ADDING_TO_CART,
      CheckoutStatus.IN_CART,
      CheckoutStatus.CHECKOUT_STARTED,
      CheckoutStatus.SHIPPING_ENTERED,
      CheckoutStatus.PAYMENT_ENTERED,
      CheckoutStatus.REVIEW,
      CheckoutStatus.SUBMITTING,
    ];

    const placeholders = activeStatuses.map((_, i) => `$${i + 1}`).join(', ');
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE status IN (${placeholders})
      ORDER BY started_at DESC
    `;
    const result = await this.db.query<CheckoutAttemptRow>(query, activeStatuses);
    return result.rows.map((row: CheckoutAttemptRow) => this.mapRowToEntity(row));
  }

  async updateStep(
    id: string,
    status: CheckoutStatus,
    currentStep: string,
    stepRecord: CheckoutStepRecord,
  ): Promise<CheckoutAttempt | null> {
    const query = `
      UPDATE ${this.tableName}
      SET status = $1,
          current_step = $2,
          step_history = step_history || $3::jsonb
      WHERE id = $4
      RETURNING *
    `;
    const result = await this.db.query<CheckoutAttemptRow>(query, [
      status,
      currentStep,
      JSON.stringify([stepRecord]),
      id,
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async markSuccess(
    id: string,
    orderNumber: string,
    totalPrice: number,
  ): Promise<CheckoutAttempt | null> {
    const query = `
      UPDATE ${this.tableName}
      SET status = $1,
          completed_at = $2,
          order_number = $3,
          total_price = $4
      WHERE id = $5
      RETURNING *
    `;
    const result = await this.db.query<CheckoutAttemptRow>(query, [
      CheckoutStatus.SUCCESS,
      new Date(),
      orderNumber,
      totalPrice,
      id,
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async markFailed(
    id: string,
    failureReason: string,
    errorCategory: ErrorCategory,
  ): Promise<CheckoutAttempt | null> {
    const query = `
      UPDATE ${this.tableName}
      SET status = $1,
          completed_at = $2,
          failure_reason = $3,
          error_category = $4
      WHERE id = $5
      RETURNING *
    `;
    const result = await this.db.query<CheckoutAttemptRow>(query, [
      CheckoutStatus.FAILED,
      new Date(),
      failureReason,
      errorCategory,
      id,
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.rows[0]!);
  }

  async getStatistics(hours: number = 24): Promise<{
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    averageDurationMs: number;
  }> {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE completed_at IS NOT NULL) as avg_duration_ms
      FROM ${this.tableName}
      WHERE started_at >= NOW() - INTERVAL '${hours} hours'
    `;
    const result = await this.db.query<{
      total: string;
      successful: string;
      failed: string;
      avg_duration_ms: string | null;
    }>(query);

    const row = result.rows[0];
    const total = parseInt(row?.total ?? '0', 10);
    const successful = parseInt(row?.successful ?? '0', 10);

    return {
      total,
      successful,
      failed: parseInt(row?.failed ?? '0', 10),
      successRate: total > 0 ? (successful / total) * 100 : 0,
      averageDurationMs: row?.avg_duration_ms !== null ? parseFloat(row?.avg_duration_ms ?? '0') : 0,
    };
  }
  async findByUserId(
    userId: string,
    pagination?: { page: number; limit: number },
  ): Promise<{ data: CheckoutAttempt[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean } }> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const offset = (page - 1) * limit;

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE user_id = $1`,
      [userId],
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    const totalPages = Math.ceil(total / limit);

    const query = `
      SELECT * FROM ${this.tableName}
      WHERE user_id = $1
      ORDER BY started_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await this.db.query<CheckoutAttemptRow>(query, [userId, limit, offset]);
    const data = result.rows.map((row: CheckoutAttemptRow) => this.mapRowToEntity(row));

    return {
      data,
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

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.db.query<{ id: string }>(
      `DELETE FROM ${this.tableName} WHERE user_id = $1 RETURNING id`,
      [userId],
    );
    return result.rowCount ?? 0;
  }

}

let checkoutAttemptRepositoryInstance: CheckoutAttemptRepository | null = null;

export function getCheckoutAttemptRepository(): CheckoutAttemptRepository {
  if (checkoutAttemptRepositoryInstance === null) {
    checkoutAttemptRepositoryInstance = new CheckoutAttemptRepository();
  }
  return checkoutAttemptRepositoryInstance;
}
