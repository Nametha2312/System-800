import {
  SKU,
  StockStatus,
  MonitoringStatus,
  RetailerType,
  PaginationParams,
  PaginatedResponse,
  SKUMetadata,
} from '../types/index.js';
import { getSKURepository, SKURepository } from '../persistence/repositories/sku.repository.js';
import { getAdapterFactory, AdapterFactory } from '../adapters/factory.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';
import { CreateSKUInput, UpdateSKUInput } from '../utils/validation.js';

// Lazy import to avoid circular deps; poller may not be active in all modes
function tryNotifyPollerActivated(sku: SKU): void {
  import('../queue/poller.js').then(({ notifyPollerSKUActivated }) => notifyPollerSKUActivated(sku)).catch(() => {});
}
function tryNotifyPollerDeactivated(skuId: string): void {
  import('../queue/poller.js').then(({ notifyPollerSKUDeactivated }) => notifyPollerSKUDeactivated(skuId)).catch(() => {});
}

export interface SKUService {
  create(input: CreateSKUInput): Promise<SKU>;
  update(id: string, input: UpdateSKUInput): Promise<SKU>;
  delete(id: string): Promise<boolean>;
  getById(id: string): Promise<SKU | null>;
  getAll(pagination?: PaginationParams): Promise<PaginatedResponse<SKU>>;
  getByRetailer(retailer: RetailerType): Promise<SKU[]>;
  getActiveForMonitoring(): Promise<SKU[]>;
  startMonitoring(id: string): Promise<SKU>;
  pauseMonitoring(id: string): Promise<SKU>;
  stopMonitoring(id: string): Promise<SKU>;
  updateStockStatus(id: string, status: StockStatus, price: number | null): Promise<SKU>;
  enableAutoCheckout(id: string): Promise<SKU>;
  disableAutoCheckout(id: string): Promise<SKU>;
  getStatistics(): Promise<SKUStatistics>;
}

export interface SKUStatistics {
  total: number;
  active: number;
  paused: number;
  stopped: number;
  inStock: number;
  outOfStock: number;
  withAutoCheckout: number;
}

class SKUServiceImpl implements SKUService {
  private readonly repository: SKURepository;
  private readonly adapterFactory: AdapterFactory;
  private readonly logger: Logger;

  constructor(
    repository?: SKURepository,
    adapterFactory?: AdapterFactory,
  ) {
    this.repository = repository ?? getSKURepository();
    this.adapterFactory = adapterFactory ?? getAdapterFactory();
    this.logger = getLogger().child({ service: 'SKUService' });
  }

  async create(input: CreateSKUInput): Promise<SKU> {
    this.logger.info('Creating new SKU', { retailer: input.retailer, productId: input.productId });

    const existing = await this.repository.findByRetailerAndProductId(
      input.retailer,
      input.productId,
    );

    if (existing !== null) {
      throw new Error(
        `SKU already exists for retailer ${input.retailer} and product ${input.productId}`,
      );
    }

    const adapter = this.adapterFactory.getAdapter(input.retailer);
    if (!adapter.validateUrl(input.productUrl)) {
      throw new Error(`Invalid URL for retailer ${input.retailer}: ${input.productUrl}`);
    }

    const sku = await this.repository.create({
      retailer: input.retailer,
      productId: input.productId,
      productUrl: input.productUrl,
      productName: input.productName,
      targetPrice: input.targetPrice ?? null,
      currentPrice: null,
      currentStockStatus: StockStatus.UNKNOWN,
      monitoringStatus: MonitoringStatus.STOPPED,
      autoCheckoutEnabled: input.autoCheckoutEnabled,
      pollingIntervalMs: input.pollingIntervalMs,
      lastCheckedAt: null,
      lastStockChangeAt: null,
      consecutiveErrors: 0,
      metadata: input.metadata as SKUMetadata,
      deletedAt: null,
    });

    const metrics = getMetricsCollector();
    metrics.setGauge(MetricNames.ACTIVE_SKUS, await this.getActiveCount());

    this.logger.info('SKU created successfully', { skuId: sku.id });
    return sku;
  }

  async update(id: string, input: UpdateSKUInput): Promise<SKU> {
    this.logger.info('Updating SKU', { skuId: id });

    const existing = await this.repository.findById(id);
    if (existing === null) {
      throw new Error(`SKU not found: ${id}`);
    }

    if (input.productUrl !== undefined && input.retailer !== undefined) {
      const adapter = this.adapterFactory.getAdapter(input.retailer);
      if (!adapter.validateUrl(input.productUrl)) {
        throw new Error(`Invalid URL for retailer ${input.retailer}: ${input.productUrl}`);
      }
    }

    const updated = await this.repository.update(id, {
      ...(input.retailer !== undefined && { retailer: input.retailer }),
      ...(input.productId !== undefined && { productId: input.productId }),
      ...(input.productUrl !== undefined && { productUrl: input.productUrl }),
      ...(input.productName !== undefined && { productName: input.productName }),
      ...(input.targetPrice !== undefined && { targetPrice: input.targetPrice }),
      ...(input.autoCheckoutEnabled !== undefined && { autoCheckoutEnabled: input.autoCheckoutEnabled }),
      ...(input.pollingIntervalMs !== undefined && { pollingIntervalMs: input.pollingIntervalMs }),
      ...(input.monitoringStatus !== undefined && { monitoringStatus: input.monitoringStatus }),
      ...(input.metadata !== undefined && { metadata: input.metadata as SKUMetadata }),
    });

    if (updated === null) {
      throw new Error(`Failed to update SKU: ${id}`);
    }

    this.logger.info('SKU updated successfully', { skuId: id });
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    this.logger.info('Deleting SKU', { skuId: id });

    const result = await this.repository.softDelete(id);

    if (result) {
      const metrics = getMetricsCollector();
      metrics.setGauge(MetricNames.ACTIVE_SKUS, await this.getActiveCount());
      this.logger.info('SKU deleted successfully', { skuId: id });
    }

    return result;
  }

  async getById(id: string): Promise<SKU | null> {
    return this.repository.findById(id);
  }

  async getAll(pagination?: PaginationParams): Promise<PaginatedResponse<SKU>> {
    return this.repository.findAll(pagination);
  }

  async getByRetailer(retailer: RetailerType): Promise<SKU[]> {
    return this.repository.findByRetailer(retailer);
  }

  async getActiveForMonitoring(): Promise<SKU[]> {
    return this.repository.findActiveForMonitoring();
  }

  async startMonitoring(id: string): Promise<SKU> {
    this.logger.info('Starting monitoring for SKU', { skuId: id });

    const sku = await this.repository.update(id, {
      monitoringStatus: MonitoringStatus.ACTIVE,
      consecutiveErrors: 0,
    });

    if (sku === null) {
      throw new Error(`SKU not found: ${id}`);
    }

    const metrics = getMetricsCollector();
    metrics.setGauge(MetricNames.ACTIVE_SKUS, await this.getActiveCount());

    // Notify in-process poller
    tryNotifyPollerActivated(sku);

    this.logger.info('Monitoring started for SKU', { skuId: id });
    return sku;
  }

  async pauseMonitoring(id: string): Promise<SKU> {
    this.logger.info('Pausing monitoring for SKU', { skuId: id });

    const sku = await this.repository.update(id, {
      monitoringStatus: MonitoringStatus.PAUSED,
    });

    if (sku === null) {
      throw new Error(`SKU not found: ${id}`);
    }

    const metrics = getMetricsCollector();
    metrics.setGauge(MetricNames.ACTIVE_SKUS, await this.getActiveCount());
    metrics.setGauge(MetricNames.PAUSED_SKUS, await this.getPausedCount());

    // Notify in-process poller
    tryNotifyPollerDeactivated(id);

    this.logger.info('Monitoring paused for SKU', { skuId: id });
    return sku;
  }

  async stopMonitoring(id: string): Promise<SKU> {
    this.logger.info('Stopping monitoring for SKU', { skuId: id });

    const sku = await this.repository.update(id, {
      monitoringStatus: MonitoringStatus.STOPPED,
    });

    if (sku === null) {
      throw new Error(`SKU not found: ${id}`);
    }

    const metrics = getMetricsCollector();
    metrics.setGauge(MetricNames.ACTIVE_SKUS, await this.getActiveCount());

    // Notify in-process poller
    tryNotifyPollerDeactivated(id);

    this.logger.info('Monitoring stopped for SKU', { skuId: id });
    return sku;
  }

  async updateStockStatus(id: string, status: StockStatus, price: number | null): Promise<SKU> {
    const sku = await this.repository.updateStockStatus(id, status, price);

    if (sku === null) {
      throw new Error(`SKU not found: ${id}`);
    }

    return sku;
  }

  async enableAutoCheckout(id: string): Promise<SKU> {
    this.logger.info('Enabling auto-checkout for SKU', { skuId: id });

    const sku = await this.repository.update(id, {
      autoCheckoutEnabled: true,
    });

    if (sku === null) {
      throw new Error(`SKU not found: ${id}`);
    }

    this.logger.info('Auto-checkout enabled for SKU', { skuId: id });
    return sku;
  }

  async disableAutoCheckout(id: string): Promise<SKU> {
    this.logger.info('Disabling auto-checkout for SKU', { skuId: id });

    const sku = await this.repository.update(id, {
      autoCheckoutEnabled: false,
    });

    if (sku === null) {
      throw new Error(`SKU not found: ${id}`);
    }

    this.logger.info('Auto-checkout disabled for SKU', { skuId: id });
    return sku;
  }

  async getStatistics(): Promise<SKUStatistics> {
    return this.repository.getStatistics();
  }

  private async getActiveCount(): Promise<number> {
    const stats = await this.repository.getStatistics();
    return stats.active;
  }

  private async getPausedCount(): Promise<number> {
    const stats = await this.repository.getStatistics();
    return stats.paused;
  }
}

let skuServiceInstance: SKUService | null = null;

export function getSKUService(): SKUService {
  if (skuServiceInstance === null) {
    skuServiceInstance = new SKUServiceImpl();
  }
  return skuServiceInstance;
}

export { SKUServiceImpl };
