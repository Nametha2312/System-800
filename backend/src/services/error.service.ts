import {
  ErrorLog,
  ErrorCategory,
  ErrorSeverity,
  PaginationParams,
  PaginatedResponse,
} from '../types/index.js';
import {
  getErrorLogRepository,
  ErrorLogRepository,
} from '../persistence/repositories/error-log.repository.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';

export interface LogErrorInput {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  skuId?: string;
  userId?: string;
  requestId?: string;
}

export interface ErrorFilter {
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  skuId?: string;
  userId?: string;
  resolved?: boolean;
  startDate?: Date;
  endDate?: Date;
}

export interface ErrorService {
  logError(input: LogErrorInput): Promise<ErrorLog>;
  getById(id: string): Promise<ErrorLog | null>;
  getAll(pagination?: PaginationParams): Promise<PaginatedResponse<ErrorLog>>;
  getByFilter(filter: ErrorFilter, pagination?: PaginationParams): Promise<PaginatedResponse<ErrorLog>>;
  resolve(id: string, resolution: string): Promise<ErrorLog>;
  getRecentErrors(limit?: number): Promise<ErrorLog[]>;
  getErrorCounts(): Promise<ErrorCounts>;
  getUnresolvedErrors(): Promise<ErrorLog[]>;
}

export interface ErrorCounts {
  total: number;
  unresolved: number;
  byCategory: Record<ErrorCategory, number>;
  bySeverity: Record<ErrorSeverity, number>;
}

class ErrorServiceImpl implements ErrorService {
  private readonly repository: ErrorLogRepository;
  private readonly logger: Logger;

  constructor(repository?: ErrorLogRepository) {
    this.repository = repository ?? getErrorLogRepository();
    this.logger = getLogger().child({ service: 'ErrorService' });
  }

  async logError(input: LogErrorInput): Promise<ErrorLog> {
    this.logger.error('Logging error', undefined, {
      errorCategory: input.category,
      ...(input.skuId !== undefined && { skuId: input.skuId }),
    });

    const errorLog = await this.repository.create({
      category: input.category,
      severity: input.severity,
      message: input.message,
      stack: input.stack ?? null,
      context: {
        ...(input.skuId !== undefined && { skuId: input.skuId }),
        ...(input.context !== undefined && { additionalInfo: input.context }),
      },
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
    });

    const metrics = getMetricsCollector();
    metrics.incrementCounter(MetricNames.MONITORING_ERRORS);

    return errorLog;
  }

  async getById(id: string): Promise<ErrorLog | null> {
    return this.repository.findById(id);
  }

  async getAll(pagination?: PaginationParams): Promise<PaginatedResponse<ErrorLog>> {
    return this.repository.findAll(pagination);
  }

  async getByFilter(
    filter: ErrorFilter,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<ErrorLog>> {
    const conditions: Record<string, unknown> = {};

    if (filter.category !== undefined) {
      conditions['category'] = filter.category;
    }
    if (filter.severity !== undefined) {
      conditions['severity'] = filter.severity;
    }
    if (filter.skuId !== undefined) {
      conditions['sku_id'] = filter.skuId;
    }
    if (filter.userId !== undefined) {
      conditions['user_id'] = filter.userId;
    }
    if (filter.resolved !== undefined) {
      conditions['resolved'] = filter.resolved;
    }

    if (filter.startDate !== undefined || filter.endDate !== undefined) {
      // Date filtering handled via findAll with conditions
      return this.repository.findAll(pagination);
    }

    return this.repository.findWhere(conditions, pagination);
  }

  async resolve(id: string, resolution: string): Promise<ErrorLog> {
    this.logger.info('Resolving error', { errorId: id });

    const errorLog = await this.repository.resolve(id, resolution);
    if (errorLog === null) {
      throw new Error(`Error log not found: ${id}`);
    }

    this.logger.info('Error resolved', { errorId: id });
    return errorLog;
  }

  async getRecentErrors(limit = 50): Promise<ErrorLog[]> {
    const result = await this.repository.findAll({ page: 1, limit });
    return result.data;
  }

  async getErrorCounts(): Promise<ErrorCounts> {
    const unresolved = await this.getUnresolvedCount();
    const total = await this.getTotalCount();

    const byCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.NETWORK_ERROR]: 0,
      [ErrorCategory.TIMEOUT_ERROR]: 0,
      [ErrorCategory.RATE_LIMITED]: 0,
      [ErrorCategory.FORBIDDEN]: 0,
      [ErrorCategory.DOM_CHANGED]: 0,
      [ErrorCategory.PARTIAL_LOAD]: 0,
      [ErrorCategory.AUTH_EXPIRED]: 0,
      [ErrorCategory.QUEUE_OVERFLOW]: 0,
      [ErrorCategory.REDIS_ERROR]: 0,
      [ErrorCategory.DATABASE_ERROR]: 0,
      [ErrorCategory.PAYMENT_REJECTED]: 0,
      [ErrorCategory.RACE_CONDITION]: 0,
      [ErrorCategory.VALIDATION_ERROR]: 0,
      [ErrorCategory.UNKNOWN_ERROR]: 0,
      [ErrorCategory.UNKNOWN]: 0,
    };

    const bySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.DEBUG]: 0,
      [ErrorSeverity.INFO]: 0,
      [ErrorSeverity.WARNING]: 0,
      [ErrorSeverity.ERROR]: 0,
      [ErrorSeverity.CRITICAL]: 0,
    };

    for (const category of Object.values(ErrorCategory)) {
      const result = await this.repository.findByCategory(category);
      byCategory[category] = result.length;
    }

    for (const severity of Object.values(ErrorSeverity)) {
      const result = await this.repository.findBySeverity(severity);
      bySeverity[severity] = result.length;
    }

    return {
      total,
      unresolved,
      byCategory,
      bySeverity,
    };
  }

  async getUnresolvedErrors(): Promise<ErrorLog[]> {
    return this.repository.findUnresolved();
  }

  private async getUnresolvedCount(): Promise<number> {
    const errors = await this.repository.findUnresolved();
    return errors.length;
  }

  private async getTotalCount(): Promise<number> {
    const result = await this.repository.findAll({ page: 1, limit: 1 });
    return result.pagination.total;
  }
}

let errorServiceInstance: ErrorService | null = null;

export function getErrorService(): ErrorService {
  if (errorServiceInstance === null) {
    errorServiceInstance = new ErrorServiceImpl();
  }
  return errorServiceInstance;
}

export { ErrorServiceImpl };
