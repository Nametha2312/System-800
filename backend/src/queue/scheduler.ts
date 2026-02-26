// BullMQ v5 removed QueueScheduler - workers now handle delayed/repeating jobs automatically
import { RetailerType, MonitoringStatus } from '../types/index.js';
import {
  QUEUE_NAMES,
  getQueueManager,
  MonitoringJobData,
} from './queues.js';
import { getSKUService } from '../services/sku.service.js';
import { getLogger, Logger } from '../observability/logger.js';

export interface Scheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  scheduleMonitoringForSKU(skuId: string): Promise<void>;
  unscheduleMonitoringForSKU(skuId: string): Promise<void>;
  rescheduleAll(): Promise<void>;
  getScheduledJobCount(): Promise<number>;
}

class SchedulerImpl implements Scheduler {
  private readonly logger: Logger;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly syncIntervalMs = 60000;
  private started = false;

  constructor() {
    this.logger = getLogger().child({ component: 'Scheduler' });
  }

  async start(): Promise<void> {
    this.logger.info('Starting scheduler service');

    await this.rescheduleAll();

    this.syncInterval = setInterval(() => {
      void this.syncActiveMonitoring();
    }, this.syncIntervalMs);

    this.started = true;
    this.logger.info('Scheduler service started');
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping scheduler service');

    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.started = false;
    this.logger.info('Scheduler service stopped');
  }

  async scheduleMonitoringForSKU(skuId: string): Promise<void> {
    const skuService = getSKUService();
    const sku = await skuService.getById(skuId);

    if (sku === null) {
      this.logger.warn('SKU not found for scheduling', { skuId });
      return;
    }

    if (sku.monitoringStatus !== MonitoringStatus.ACTIVE) {
      this.logger.debug('SKU not active, skipping scheduling', { skuId });
      return;
    }

    // Validate required fields for monitoring
    if (!sku.retailer || !sku.productUrl || !sku.productId) {
      this.logger.error('SKU missing required fields for scheduling', {
        skuId,
        hasRetailer: !!sku.retailer,
        hasProductUrl: !!sku.productUrl,
        hasProductId: !!sku.productId,
        retailer: sku.retailer,
      });
      throw new Error(
        `SKU ${skuId} missing required fields: retailer=${sku.retailer}, productUrl=${sku.productUrl}, productId=${sku.productId}`,
      );
    }

    // Check if we're in Redis-skip mode
    const skipRedisConnect = process.env.SKIP_REDIS_CONNECT === 'true';

    if (skipRedisConnect) {
      this.logger.info('Redis skipped, in-process poller will handle monitoring', { skuId });
      return;
    }

    try {
      const queueManager = getQueueManager();
      const jobData: MonitoringJobData = {
        skuId: sku.id,
        retailer: sku.retailer,
        productUrl: sku.productUrl,
        productId: sku.productId,
        pollingIntervalMs: sku.pollingIntervalMs,
      };

      await queueManager.addMonitoringJob(jobData, {
        repeat: {
          every: sku.pollingIntervalMs,
          immediately: true,
        },
      });

      this.logger.info('Monitoring scheduled for SKU (BullMQ)', {
        skuId,
        intervalMs: sku.pollingIntervalMs,
      });
    } catch (error) {
      // If queue scheduling fails (e.g., Redis not available), the in-process poller will handle it
      this.logger.warn('Queue scheduling failed, will use in-process poller', {
        skuId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async unscheduleMonitoringForSKU(skuId: string): Promise<void> {
    const skuService = getSKUService();
    const sku = await skuService.getById(skuId);

    if (sku === null) {
      this.logger.warn('SKU not found for unscheduling', { skuId });
      return;
    }

    // Check if we're in Redis-skip mode
    const skipRedisConnect = process.env.SKIP_REDIS_CONNECT === 'true';
    if (skipRedisConnect) {
      this.logger.info('Redis skipped, in-process poller will handle monitoring', { skuId });
      return;
    }

    const queueManager = getQueueManager();
    await queueManager.removeMonitoringJob(skuId, sku.retailer);

    const queue = queueManager.getMonitoringQueue(sku.retailer);
    const repeatableJobs = await queue.getRepeatableJobs();

    for (const job of repeatableJobs) {
      if (job.id?.includes(skuId) === true) {
        await queue.removeRepeatableByKey(job.key);
        this.logger.debug('Repeatable job removed', { skuId, key: job.key });
      }
    }

    this.logger.info('Monitoring unscheduled for SKU', { skuId });
  }

  async rescheduleAll(): Promise<void> {
    this.logger.info('Rescheduling all active monitoring jobs');

    // Check if we're in Redis-skip mode
    const skipRedisConnect = process.env.SKIP_REDIS_CONNECT === 'true';
    if (skipRedisConnect) {
      this.logger.info('Redis skipped, in-process poller will handle all monitoring');
      return;
    }

    const skuService = getSKUService();
    const activeSKUs = await skuService.getActiveForMonitoring();

    const byRetailer = new Map<RetailerType, typeof activeSKUs>();
    for (const sku of activeSKUs) {
      const list = byRetailer.get(sku.retailer) ?? [];
      list.push(sku);
      byRetailer.set(sku.retailer, list);
    }

    let scheduledCount = 0;

    for (const [retailer, skus] of byRetailer.entries()) {
      const queueManager = getQueueManager();
      const queue = queueManager.getMonitoringQueue(retailer);

      const existingJobs = await queue.getRepeatableJobs();
      for (const job of existingJobs) {
        await queue.removeRepeatableByKey(job.key);
      }

      for (const sku of skus) {
        await this.scheduleMonitoringForSKU(sku.id);
        scheduledCount++;
      }
    }

    this.logger.info('Rescheduling complete', { scheduledCount });
  }

  async getScheduledJobCount(): Promise<number> {
    let totalCount = 0;

    for (const retailer of Object.values(RetailerType)) {
      const queueManager = getQueueManager();
      const queue = queueManager.getMonitoringQueue(retailer);
      const jobs = await queue.getRepeatableJobs();
      totalCount += jobs.length;
    }

    return totalCount;
  }

  private async syncActiveMonitoring(): Promise<void> {
    try {
      const skuService = getSKUService();
      const activeSKUs = await skuService.getActiveForMonitoring();
      const scheduledCount = await this.getScheduledJobCount();

      if (activeSKUs.length !== scheduledCount) {
        this.logger.warn({
          activeSKUs: activeSKUs.length,
          scheduledJobs: scheduledCount,
        }, 'Monitoring sync mismatch detected');
        await this.rescheduleAll();
      }
    } catch (error) {
      this.logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Sync monitoring failed');
    }
  }
}

let schedulerInstance: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (schedulerInstance === null) {
    schedulerInstance = new SchedulerImpl();
  }
  return schedulerInstance;
}

export { SchedulerImpl };
