import {
  Alert,
  AlertType,
  ErrorSeverity,
  PaginationParams,
  PaginatedResponse,
} from '../types/index.js';
import { getAlertRepository, AlertRepository } from '../persistence/repositories/alert.repository.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';
import { emitNewAlert } from '../utils/socket-manager.js';
import { getNotificationService } from './notification.service.js';

export interface CreateAlertInput {
  skuId: string;
  type: AlertType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AlertFilter {
  skuId?: string;
  type?: AlertType;
  isRead?: boolean;
  startDate?: Date;
  endDate?: Date;
}

export interface AlertService {
  createAlert(input: CreateAlertInput): Promise<Alert>;
  getById(id: string): Promise<Alert | null>;
  getAll(pagination?: PaginationParams): Promise<PaginatedResponse<Alert>>;
  getByFilter(filter: AlertFilter, pagination?: PaginationParams): Promise<PaginatedResponse<Alert>>;
  getUnacknowledged(): Promise<Alert[]>;
  acknowledge(id: string): Promise<Alert>;
  acknowledgeAll(skuId?: string): Promise<number>;
  getRecentBySKU(skuId: string, limit?: number): Promise<Alert[]>;
  getAlertCounts(): Promise<AlertCounts>;
}

export interface AlertCounts {
  total: number;
  pending: number;
  acknowledged: number;
  byType: Record<AlertType, number>;
}

class AlertServiceImpl implements AlertService {
  private readonly repository: AlertRepository;
  private readonly logger: Logger;

  constructor(repository?: AlertRepository) {
    this.repository = repository ?? getAlertRepository();
    this.logger = getLogger().child({ service: 'AlertService' });
  }

  async createAlert(input: CreateAlertInput): Promise<Alert> {
    this.logger.info('Creating alert', {
      type: input.type,
      skuId: input.skuId,
      title: input.title,
    });

    const alert = await this.repository.create({
      skuId: input.skuId,
      type: input.type,
      title: input.title,
      message: input.message,
      severity: ErrorSeverity.INFO,
      isRead: false,
      metadata: input.metadata ?? {},
      acknowledgedAt: null,
      acknowledgedBy: null,
    });

    const metrics = getMetricsCollector();
    metrics.incrementCounter(MetricNames.ALERTS_GENERATED);
    metrics.setGauge(MetricNames.ACTIVE_ALERTS, await this.getPendingCount());

    this.logger.info('Alert created', { alertId: alert.id, type: alert.type });

    // Push alert to all connected WebSocket clients in real-time
    emitNewAlert({
      id: alert.id,
      type: alert.type,
      title: alert.title,
      message: alert.message,
      skuId: alert.skuId,
      severity: alert.severity ?? 'info',
      isRead: alert.isRead,
      createdAt: alert.createdAt instanceof Date ? alert.createdAt.toISOString() : String(alert.createdAt),
      metadata: alert.metadata as Record<string, unknown> | undefined,
    });

    // Dispatch external notification (fire-and-forget — never blocks, never throws)
    const meta = alert.metadata as Record<string, unknown> | undefined;
    getNotificationService().dispatch({
      eventType: alert.type,
      site: String(meta?.retailer ?? 'UNKNOWN'),
      productId: String(meta?.productId ?? alert.skuId ?? ''),
      productName: String(meta?.productName ?? input.title),
      message: alert.message,
      timestamp: alert.createdAt instanceof Date
        ? alert.createdAt.toISOString()
        : new Date().toISOString(),
      metadata: meta,
    });

    return alert;
  }

  async getById(id: string): Promise<Alert | null> {
    return this.repository.findById(id);
  }

  async getAll(pagination?: PaginationParams): Promise<PaginatedResponse<Alert>> {
    return this.repository.findAll(pagination);
  }

  async getByFilter(
    filter: AlertFilter,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<Alert>> {
    const conditions: Record<string, unknown> = {};

    if (filter.skuId !== undefined) {
      conditions['sku_id'] = filter.skuId;
    }
    if (filter.type !== undefined) {
      conditions['type'] = filter.type;
    }
    if (filter.isRead !== undefined) {
      conditions['is_read'] = filter.isRead;
    }

    if (filter.startDate !== undefined || filter.endDate !== undefined) {
      return this.repository.findByDateRange(
        filter.startDate ?? new Date(0),
        filter.endDate ?? new Date(),
        pagination,
      );
    }

    return this.repository.findWhere(conditions, pagination);
  }

  async getUnacknowledged(): Promise<Alert[]> {
    return this.repository.findUnacknowledged();
  }

  async acknowledge(id: string): Promise<Alert> {
    this.logger.info('Acknowledging alert', { alertId: id });

    const alert = await this.repository.acknowledge(id, 'system');

    if (alert === null) {
      throw new Error(`Alert not found: ${id}`);
    }

    const metrics = getMetricsCollector();
    metrics.setGauge(MetricNames.ACTIVE_ALERTS, await this.getPendingCount());

    this.logger.info('Alert acknowledged', { alertId: id });
    return alert;
  }

  async acknowledgeAll(skuId?: string): Promise<number> {
    this.logger.info('Acknowledging all alerts', { skuId });

    const count = await this.repository.acknowledgeAll(skuId);

    const metrics = getMetricsCollector();
    metrics.setGauge(MetricNames.ACTIVE_ALERTS, await this.getPendingCount());

    this.logger.info('Alerts acknowledged', { count, skuId });
    return count;
  }

  async getRecentBySKU(skuId: string, limit = 20): Promise<Alert[]> {
    return this.repository.findBySKU(skuId, limit);
  }

  async getAlertCounts(): Promise<AlertCounts> {
    const pending = await this.getPendingCount();
    const total = await this.getTotalCount();

    const byType: Record<AlertType, number> = {
      [AlertType.STOCK_AVAILABLE]: 0,
      [AlertType.STOCK_UNAVAILABLE]: 0,
      [AlertType.STOCK_LOW]: 0,
      [AlertType.PRICE_CHANGE]: 0,
      [AlertType.PRICE_DROP]: 0,
      [AlertType.PRICE_INCREASE]: 0,
      [AlertType.CHECKOUT_SUCCESS]: 0,
      [AlertType.CHECKOUT_FAILED]: 0,
      [AlertType.SYSTEM_ERROR]: 0,
      [AlertType.MONITORING_ERROR]: 0,
      [AlertType.CIRCUIT_BREAKER_OPEN]: 0,
      [AlertType.ERROR]: 0,
    };

    for (const type of Object.values(AlertType)) {
      const result = await this.repository.findWhere({ type }, { page: 1, limit: 1 });
      byType[type] = result.pagination.total;
    }

    return {
      total,
      pending,
      acknowledged: total - pending,
      byType,
    };
  }

  private async getPendingCount(): Promise<number> {
    // Find alerts with isRead = false
    const result = await this.repository.findWhere({ is_read: false }, { page: 1, limit: 1 });
    return result.pagination.total;
  }

  private async getTotalCount(): Promise<number> {
    const result = await this.repository.findAll({ page: 1, limit: 1 });
    return result.pagination.total;
  }
}

let alertServiceInstance: AlertService | null = null;

export function getAlertService(): AlertService {
  if (alertServiceInstance === null) {
    alertServiceInstance = new AlertServiceImpl();
  }
  return alertServiceInstance;
}

export { AlertServiceImpl };
