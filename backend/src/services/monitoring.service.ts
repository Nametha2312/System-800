import {
  SKU,
  StockStatus,
  MonitoringEvent,
  AlertType,
  RetailerType,
} from '../types/index.js';
import { getSKUService, SKUService } from './sku.service.js';
import { getAlertService, AlertService } from './alert.service.js';
import { getAdapterFactory, AdapterFactory } from '../adapters/factory.js';
import {
  getMonitoringEventRepository,
  MonitoringEventRepository,
} from '../persistence/repositories/monitoring-event.repository.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';

export interface MonitoringResult {
  skuId: string;
  productId: string;
  retailer: RetailerType;
  previousStatus: StockStatus;
  currentStatus: StockStatus;
  previousPrice: number | null;
  currentPrice: number | null;
  statusChanged: boolean;
  priceChanged: boolean;
  meetsTargetPrice: boolean;
  executionTimeMs: number;
  error: string | null;
}

export interface MonitoringService {
  checkProduct(sku: SKU): Promise<MonitoringResult>;
  processCheckResult(result: MonitoringResult): Promise<void>;
  recordCheckFailure(skuId: string, error: Error): Promise<void>;
  getRecentEvents(skuId: string, limit?: number): Promise<MonitoringEvent[]>;
  getStockChanges(skuId: string, limit?: number): Promise<MonitoringEvent[]>;
  shouldTriggerCheckout(result: MonitoringResult): boolean;
}

class MonitoringServiceImpl implements MonitoringService {
  private readonly skuService: SKUService;
  private readonly alertService: AlertService;
  private readonly adapterFactory: AdapterFactory;
  private readonly eventRepository: MonitoringEventRepository;
  private readonly logger: Logger;
  private readonly maxConsecutiveErrors = 5;

  constructor(
    skuService?: SKUService,
    alertService?: AlertService,
    adapterFactory?: AdapterFactory,
    eventRepository?: MonitoringEventRepository,
  ) {
    this.skuService = skuService ?? getSKUService();
    this.alertService = alertService ?? getAlertService();
    this.adapterFactory = adapterFactory ?? getAdapterFactory();
    this.eventRepository = eventRepository ?? getMonitoringEventRepository();
    this.logger = getLogger().child({ service: 'MonitoringService' });
  }

  async checkProduct(sku: SKU): Promise<MonitoringResult> {
    const startTime = Date.now();
    const metrics = getMetricsCollector();

    this.logger.debug('Checking product availability', {
      skuId: sku.id,
      retailer: sku.retailer,
      productId: sku.productId,
    });

    const result: MonitoringResult = {
      skuId: sku.id,
      productId: sku.productId,
      retailer: sku.retailer,
      previousStatus: sku.currentStockStatus,
      currentStatus: StockStatus.UNKNOWN,
      previousPrice: sku.currentPrice,
      currentPrice: null,
      statusChanged: false,
      priceChanged: false,
      meetsTargetPrice: false,
      executionTimeMs: 0,
      error: null,
    };

    try {
      const adapter = this.adapterFactory.getAdapter(sku.retailer);
      const checkResult = await adapter.checkProduct(sku.productUrl);

      if (!checkResult.success || checkResult.productInfo === undefined) {
        throw new Error(checkResult.error?.message ?? 'Failed to fetch product info');
      }

      const productInfo = checkResult.productInfo;
      result.currentStatus = productInfo.stockStatus;
      result.currentPrice = productInfo.price;
      result.statusChanged = productInfo.stockStatus !== sku.currentStockStatus;
      result.priceChanged =
        productInfo.price !== null &&
        sku.currentPrice !== null &&
        productInfo.price !== sku.currentPrice;

      if (sku.targetPrice !== null && productInfo.price !== null) {
        result.meetsTargetPrice = productInfo.price <= sku.targetPrice;
      }

      metrics.incrementCounter(MetricNames.MONITORING_CHECKS);
      this.logger.debug('Product check completed', {
        skuId: sku.id,
        status: productInfo.stockStatus,
        price: productInfo.price,
        statusChanged: result.statusChanged,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      result.error = err.message;
      metrics.incrementCounter(MetricNames.MONITORING_ERRORS);

      this.logger.error('Product check failed', err, {
        skuId: sku.id,
      });
    }

    result.executionTimeMs = Date.now() - startTime;
    metrics.recordLatency(MetricNames.ADAPTER_LATENCY, result.executionTimeMs);

    return result;
  }

  async processCheckResult(result: MonitoringResult): Promise<void> {
    const metrics = getMetricsCollector();

    if (result.error !== null) {
      await this.recordCheckFailure(result.skuId, new Error(result.error));
      return;
    }

    const sku = await this.skuService.updateStockStatus(
      result.skuId,
      result.currentStatus,
      result.currentPrice,
    );

    await this.eventRepository.create({
      skuId: result.skuId,
      eventType: result.statusChanged ? 'STOCK_CHANGE' : result.priceChanged ? 'PRICE_CHANGE' : 'CHECK',
      previousStockStatus: result.previousStatus,
      newStockStatus: result.currentStatus,
      previousPrice: result.previousPrice,
      newPrice: result.currentPrice,
      errorCategory: null,
      errorMessage: null,
      responseTimeMs: result.executionTimeMs,
      metadata: {},
    });

    if (result.statusChanged) {
      this.logger.info('Stock status changed', {
        skuId: result.skuId,
        from: result.previousStatus,
        to: result.currentStatus,
      });

      if (result.currentStatus === StockStatus.IN_STOCK) {
        metrics.incrementCounter(MetricNames.IN_STOCK_DETECTIONS);

        await this.alertService.createAlert({
          skuId: result.skuId,
          type: AlertType.STOCK_AVAILABLE,
          title: 'Product In Stock',
          message: `${sku.productName} is now in stock at ${sku.retailer}`,
          metadata: {
            productId: result.productId,
            retailer: result.retailer,
            price: result.currentPrice,
            meetsTargetPrice: result.meetsTargetPrice,
          },
        });
      } else if (result.currentStatus === StockStatus.OUT_OF_STOCK) {
        await this.alertService.createAlert({
          skuId: result.skuId,
          type: AlertType.STOCK_UNAVAILABLE,
          title: 'Product Out of Stock',
          message: `${sku.productName} is now out of stock at ${sku.retailer}`,
          metadata: {
            productId: result.productId,
            retailer: result.retailer,
          },
        });
      }
    }

    if (result.priceChanged) {
      this.logger.info('Price changed', {
        skuId: result.skuId,
        from: result.previousPrice,
        to: result.currentPrice,
      });

      await this.alertService.createAlert({
        skuId: result.skuId,
        type: AlertType.PRICE_CHANGE,
        title: 'Price Changed',
        message: `${sku.productName} price changed from $${result.previousPrice} to $${result.currentPrice}`,
        metadata: {
          productId: result.productId,
          retailer: result.retailer,
          previousPrice: result.previousPrice,
          newPrice: result.currentPrice,
          meetsTargetPrice: result.meetsTargetPrice,
        },
      });
    }

    if (result.meetsTargetPrice && result.currentStatus === StockStatus.IN_STOCK) {
      await this.alertService.createAlert({
        skuId: result.skuId,
        type: AlertType.PRICE_DROP,
        title: 'Target Price Met',
        message: `${sku.productName} is available at or below target price!`,
        metadata: {
          productId: result.productId,
          retailer: result.retailer,
          currentPrice: result.currentPrice,
          targetPrice: sku.targetPrice,
        },
      });
    }
  }

  async recordCheckFailure(skuId: string, error: Error): Promise<void> {
    this.logger.error('Recording check failure', error, { skuId });

    const sku = await this.skuService.getById(skuId);
    if (sku === null) {
      return;
    }

    const newErrorCount = sku.consecutiveErrors + 1;

    await this.eventRepository.create({
      skuId,
      eventType: 'ERROR',
      previousStockStatus: sku.currentStockStatus,
      newStockStatus: sku.currentStockStatus,
      previousPrice: sku.currentPrice,
      newPrice: sku.currentPrice,
      errorCategory: null,
      errorMessage: error.message,
      responseTimeMs: 0,
      metadata: {},
    });

    if (newErrorCount >= this.maxConsecutiveErrors) {
      this.logger.warn('Max consecutive errors reached, pausing monitoring', {
        skuId,
        errorCount: newErrorCount,
      });

      await this.skuService.pauseMonitoring(skuId);

      await this.alertService.createAlert({
        skuId,
        type: AlertType.MONITORING_ERROR,
        title: 'Monitoring Paused Due to Errors',
        message: `Monitoring for ${sku.productName} has been paused after ${newErrorCount} consecutive errors`,
        metadata: {
          productId: sku.productId,
          retailer: sku.retailer,
          lastError: error.message,
          errorCount: newErrorCount,
        },
      });
    }
  }

  async getRecentEvents(skuId: string, limit = 50): Promise<MonitoringEvent[]> {
    return this.eventRepository.findBySKU(skuId, limit);
  }

  async getStockChanges(skuId: string, limit = 20): Promise<MonitoringEvent[]> {
    // findStockChanges doesn't take skuId as param, so filter in memory or use findBySKU
    const events = await this.eventRepository.findBySKU(skuId, limit * 2);
    return events
      .filter(e => e.eventType === 'STOCK_CHANGE')
      .slice(0, limit);
  }

  shouldTriggerCheckout(result: MonitoringResult): boolean {
    return (
      result.error === null &&
      result.currentStatus === StockStatus.IN_STOCK &&
      (result.statusChanged || result.meetsTargetPrice)
    );
  }
}

let monitoringServiceInstance: MonitoringService | null = null;

export function getMonitoringService(): MonitoringService {
  if (monitoringServiceInstance === null) {
    monitoringServiceInstance = new MonitoringServiceImpl();
  }
  return monitoringServiceInstance;
}

export { MonitoringServiceImpl };
