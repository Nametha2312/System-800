import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

import { getConfig } from '../config/index.js';
import { getLogger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';
import { withRetry, RetryConfig } from '../utils/retry.js';
import { ErrorCategory } from '../types/index.js';

const logger = getLogger();
const metrics = getMetricsCollector();

export interface DatabaseClient {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  getClient(): Promise<PoolClient>;
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}

const RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 5000,
  retryableErrors: [ErrorCategory.DATABASE_ERROR, ErrorCategory.NETWORK_ERROR],
};

class PostgresClient implements DatabaseClient {
  private pool: Pool | null = null;
  private isClosing: boolean = false;

  async connect(): Promise<void> {
    // Initialize the pool on first connect
    this.getPool();
    // Test connection
    await this.healthCheck();
  }

  async disconnect(): Promise<void> {
    await this.close();
  }

  private getPool(): Pool {
    if (this.pool === null) {
      const config = getConfig();
      this.pool = new Pool({
        connectionString: config.database.url,
        min: config.database.poolMin,
        max: config.database.poolMax,
        idleTimeoutMillis: config.database.idleTimeoutMs,
        connectionTimeoutMillis: config.database.connectionTimeoutMs,
      });

      this.pool.on('connect', () => {
        logger.debug('Database client connected');
        metrics.incrementCounter(MetricNames.DATABASE_CONNECTIONS_ACTIVE);
      });

      this.pool.on('remove', () => {
        logger.debug('Database client removed from pool');
        metrics.decrementCounter(MetricNames.DATABASE_CONNECTIONS_ACTIVE);
      });

      this.pool.on('error', (error: Error) => {
        logger.error('Unexpected database pool error', error);
      });
    }
    return this.pool;
  }

  async query<T extends QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    if (this.isClosing) {
      throw new Error('Database client is closing');
    }

    const startTime = Date.now();

    const result = await withRetry(
      async () => {
        return this.getPool().query<T>(text, params);
      },
      RETRY_CONFIG,
    );

    const duration = Date.now() - startTime;
    metrics.recordHistogram('database_query_duration_ms', duration);

    if (!result.success) {
      throw result.error ?? new Error('Query failed');
    }

    return result.data as QueryResult<T>;
  }

  async getClient(): Promise<PoolClient> {
    if (this.isClosing) {
      throw new Error('Database client is closing');
    }

    const result = await withRetry(
      async () => {
        return this.getPool().connect();
      },
      RETRY_CONFIG,
    );

    if (!result.success) {
      throw result.error ?? new Error('Failed to get database client');
    }

    return result.data as PoolClient;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();

    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query<{ now: Date }>('SELECT NOW() as now');
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Database health check failed', error instanceof Error ? error : undefined);
      return false;
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;
    if (this.pool !== null) {
      await this.pool.end();
      this.pool = null;
      logger.info('Database pool closed');
    }
  }

  getPoolStats(): { total: number; idle: number; waiting: number } {
    const pool = this.getPool();
    return {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
  }
}

let dbInstance: PostgresClient | null = null;

export function getDatabase(): PostgresClient {
  if (dbInstance === null) {
    dbInstance = new PostgresClient();
  }
  return dbInstance;
}

// Export alias for backward compatibility
export const getPostgresClient = getDatabase;

export async function closeDatabase(): Promise<void> {
  if (dbInstance !== null) {
    await dbInstance.close();
    dbInstance = null;
  }
}

export { PostgresClient };
