import { Queue, QueueOptions, JobsOptions } from 'bullmq';
import { RetailerType } from '../types/index.js';
import { getRedisManager } from './redis.js';
import { getConfig } from '../config/index.js';
import { getLogger, Logger } from '../observability/logger.js';

export const QUEUE_NAMES = {
  MONITORING: 'monitoring',
  CHECKOUT: 'checkout',
  ALERTS: 'alerts',
  DEAD_LETTER: 'dead-letter',
  MONITORING_AMAZON: 'monitoring-amazon',
  MONITORING_BESTBUY: 'monitoring-bestbuy',
  MONITORING_WALMART: 'monitoring-walmart',
  MONITORING_TARGET: 'monitoring-target',
  MONITORING_NEWEGG: 'monitoring-newegg',
  MONITORING_CUSTOM: 'monitoring-custom',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface MonitoringJobData {
  skuId: string;
  retailer: RetailerType;
  productUrl: string;
  productId: string;
  pollingIntervalMs: number;
  priority?: number;
}

export interface CheckoutJobData {
  skuId: string;
  userId: string;
  retailer: RetailerType;
  productUrl: string;
  productId: string;
  maxPrice?: number;
  quantity?: number;
  triggeredBy: 'stock_change' | 'price_drop' | 'manual';
}

export interface AlertJobData {
  alertId: string;
  type: string;
  skuId: string;
  channels: string[];
  payload: Record<string, unknown>;
}

export interface DeadLetterJobData {
  originalQueue: string;
  originalJobId: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
}

function getRetailerQueueName(retailer: RetailerType): QueueName {
  switch (retailer) {
    case RetailerType.AMAZON:
      return QUEUE_NAMES.MONITORING_AMAZON;
    case RetailerType.BESTBUY:
      return QUEUE_NAMES.MONITORING_BESTBUY;
    case RetailerType.WALMART:
      return QUEUE_NAMES.MONITORING_WALMART;
    case RetailerType.TARGET:
      return QUEUE_NAMES.MONITORING_TARGET;
    case RetailerType.NEWEGG:
      return QUEUE_NAMES.MONITORING_NEWEGG;
    case RetailerType.CUSTOM:
      return QUEUE_NAMES.MONITORING_CUSTOM;
    default:
      return QUEUE_NAMES.MONITORING;
  }
}

class QueueManager {
  private readonly queues: Map<string, Queue> = new Map();
  private readonly logger: Logger;
  private readonly defaultJobOptions: JobsOptions;

  constructor() {
    this.logger = getLogger().child({ component: 'QueueManager' });
    const config = getConfig();

    this.defaultJobOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
        count: 5000,
      },
    };

    // Don't initialize queues yet - do it lazily when first needed
  }

  private initializeQueues(): void {
    if (this.queues.size > 0) {
      // Already initialized
      return;
    }

    try {
      const queueOptions: QueueOptions = {
        connection: getRedisManager().getClient(),
        defaultJobOptions: this.defaultJobOptions,
      };

      for (const queueName of Object.values(QUEUE_NAMES)) {
        const queue = new Queue(queueName, queueOptions);
        this.queues.set(queueName, queue);
        this.logger.info('Queue initialized', { queue: queueName });
      }
    } catch (err) {
      this.logger.error({ error: (err as Error).message }, 'Failed to initialize queues - Redis may not be available');
      throw err;
    }
  }

  getQueue(name: QueueName): Queue {
    this.initializeQueues();
    const queue = this.queues.get(name);
    if (queue === undefined) {
      throw new Error(`Queue not found: ${name}`);
    }
    return queue;
  }

  getMonitoringQueue(retailer: RetailerType): Queue {
    const queueName = getRetailerQueueName(retailer);
    return this.getQueue(queueName);
  }

  async addMonitoringJob(data: MonitoringJobData, options?: JobsOptions): Promise<string> {
    this.initializeQueues();
    const queue = this.getMonitoringQueue(data.retailer);
    const job = await queue.add('check-product', data, {
      ...this.defaultJobOptions,
      ...options,
      jobId: `monitor:${data.skuId}`,
      priority: data.priority ?? 1,
    });

    this.logger.debug('Monitoring job added', {
      jobId: job.id,
      skuId: data.skuId,
      retailer: data.retailer,
    });

    return job.id ?? '';
  }

  async addCheckoutJob(data: CheckoutJobData, options?: JobsOptions): Promise<string> {
    const queue = this.getQueue(QUEUE_NAMES.CHECKOUT);
    const job = await queue.add('attempt-checkout', data, {
      ...this.defaultJobOptions,
      ...options,
      priority: 1,
    });

    this.logger.info('Checkout job added', {
      jobId: job.id,
      skuId: data.skuId,
      retailer: data.retailer,
    });

    return job.id ?? '';
  }

  async addAlertJob(data: AlertJobData, options?: JobsOptions): Promise<string> {
    const queue = this.getQueue(QUEUE_NAMES.ALERTS);
    const job = await queue.add('send-alert', data, {
      ...this.defaultJobOptions,
      ...options,
      attempts: 5,
    });

    this.logger.debug('Alert job added', {
      jobId: job.id,
      alertId: data.alertId,
      type: data.type,
    });

    return job.id ?? '';
  }

  async addToDeadLetter(data: DeadLetterJobData): Promise<string> {
    const queue = this.getQueue(QUEUE_NAMES.DEAD_LETTER);
    const job = await queue.add('failed-job', data, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.logger.warn('Job moved to dead letter queue', {
      jobId: job.id,
      originalQueue: data.originalQueue,
      originalJobId: data.originalJobId,
      reason: data.failedReason,
    });

    return job.id ?? '';
  }

  async removeMonitoringJob(skuId: string, retailer: RetailerType): Promise<void> {
    const queue = this.getMonitoringQueue(retailer);
    const jobId = `monitor:${skuId}`;

    const job = await queue.getJob(jobId);
    if (job !== undefined) {
      await job.remove();
      this.logger.debug('Monitoring job removed', { jobId, skuId });
    }
  }

  async pauseQueue(name: QueueName): Promise<void> {
    const queue = this.getQueue(name);
    await queue.pause();
    this.logger.info('Queue paused', { queue: name });
  }

  async resumeQueue(name: QueueName): Promise<void> {
    const queue = this.getQueue(name);
    await queue.resume();
    this.logger.info('Queue resumed', { queue: name });
  }

  async getQueueStats(name: QueueName): Promise<QueueStats> {
    const queue = this.getQueue(name);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      name,
      waiting,
      active,
      completed,
      failed,
      delayed,
      isPaused: await queue.isPaused(),
    };
  }

  async getAllQueueStats(): Promise<QueueStats[]> {
    const stats: QueueStats[] = [];
    for (const queueName of Object.values(QUEUE_NAMES)) {
      stats.push(await this.getQueueStats(queueName));
    }
    return stats;
  }

  async closeAll(): Promise<void> {
    this.logger.info('Closing all queues');
    // Only close if queues were actually initialized
    for (const [name, queue] of this.queues.entries()) {
      try {
        await queue.close();
        this.logger.debug('Queue closed', { queue: name });
      } catch (err) {
        this.logger.warn('Error closing queue', { queue: name, error: (err as Error).message });
      }
    }
    this.queues.clear();
  }
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  isPaused: boolean;
}

let queueManagerInstance: QueueManager | null = null;

export function getQueueManager(): QueueManager {
  if (queueManagerInstance === null) {
    queueManagerInstance = new QueueManager();
  }
  return queueManagerInstance;
}

export { QueueManager, getRetailerQueueName };
