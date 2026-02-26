import { Job, Worker, WorkerOptions } from 'bullmq';
import { RetailerType, StockStatus, ErrorCategory, ErrorSeverity, CheckoutStatus } from '../types/index.js';
import {
  MonitoringJobData,
  CheckoutJobData,
  AlertJobData,
  QUEUE_NAMES,
  getQueueManager,
  getRetailerQueueName,
} from './queues.js';
import { getRedisManager } from './redis.js';
import { getMonitoringService, MonitoringResult } from '../services/monitoring.service.js';
import { getSKUService } from '../services/sku.service.js';
import { getCheckoutService } from '../services/checkout.service.js';
import { getErrorService } from '../services/error.service.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';
import { getProxyManager, RotationReason } from '../utils/proxy-manager.js';
import { runWithProxyContext } from '../utils/proxy-context.js';
import { getHealthMonitor } from '../utils/health-monitor.js';
import { getNotificationService } from '../services/notification.service.js';

export interface WorkerManager {
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  getWorkerStatus(): WorkerStatus[];
}

export interface WorkerStatus {
  name: string;
  running: boolean;
  concurrency: number;
}

class WorkerManagerImpl implements WorkerManager {
  private readonly workers: Map<string, Worker> = new Map();
  private readonly logger: Logger;
  private readonly concurrency: number = 5;

  constructor() {
    this.logger = getLogger().child({ component: 'WorkerManager' });
  }

  async startAll(): Promise<void> {
    this.logger.info('Starting all workers');

    const workerOptions: WorkerOptions = {
      connection: getRedisManager().getClient(),
      concurrency: this.concurrency,
      limiter: {
        max: 10,
        duration: 1000,
      },
    };

    for (const retailer of Object.values(RetailerType)) {
      const queueName = getRetailerQueueName(retailer);
      await this.createMonitoringWorker(queueName, workerOptions);
    }

    await this.createCheckoutWorker(workerOptions);
    await this.createAlertWorker(workerOptions);
    await this.createDeadLetterWorker(workerOptions);

    this.logger.info('All workers started', { count: this.workers.size });
  }

  async stopAll(): Promise<void> {
    this.logger.info('Stopping all workers');

    for (const [name, worker] of this.workers.entries()) {
      await worker.close();
      this.logger.debug('Worker stopped', { worker: name });
    }

    this.workers.clear();
    this.logger.info('All workers stopped');
  }

  getWorkerStatus(): WorkerStatus[] {
    return Array.from(this.workers.entries()).map(([name, worker]) => ({
      name,
      running: worker.isRunning(),
      concurrency: this.concurrency,
    }));
  }

  private async createMonitoringWorker(
    queueName: string,
    options: WorkerOptions,
  ): Promise<void> {
    const worker = new Worker<MonitoringJobData>(
      queueName,
      async (job) => this.processMonitoringJob(job),
      {
        ...options,
        limiter: {
          max: 5,
          duration: 10000,
        },
      },
    );

    this.setupWorkerEvents(worker, queueName);
    this.workers.set(queueName, worker);
    this.logger.info('Monitoring worker created', { queue: queueName });
  }

  private async createCheckoutWorker(options: WorkerOptions): Promise<void> {
    const worker = new Worker<CheckoutJobData>(
      QUEUE_NAMES.CHECKOUT,
      async (job) => this.processCheckoutJob(job),
      {
        ...options,
        concurrency: 2,
        limiter: {
          max: 1,
          duration: 5000,
        },
      },
    );

    this.setupWorkerEvents(worker, QUEUE_NAMES.CHECKOUT);
    this.workers.set(QUEUE_NAMES.CHECKOUT, worker);
    this.logger.info('Checkout worker created');
  }

  private async createAlertWorker(options: WorkerOptions): Promise<void> {
    const worker = new Worker<AlertJobData>(
      QUEUE_NAMES.ALERTS,
      async (job) => this.processAlertJob(job),
      {
        ...options,
        concurrency: 10,
      },
    );

    this.setupWorkerEvents(worker, QUEUE_NAMES.ALERTS);
    this.workers.set(QUEUE_NAMES.ALERTS, worker);
    this.logger.info('Alert worker created');
  }

  private async createDeadLetterWorker(options: WorkerOptions): Promise<void> {
    const worker = new Worker(
      QUEUE_NAMES.DEAD_LETTER,
      async (job) => this.processDeadLetterJob(job),
      {
        ...options,
        concurrency: 1,
      },
    );

    this.setupWorkerEvents(worker, QUEUE_NAMES.DEAD_LETTER);
    this.workers.set(QUEUE_NAMES.DEAD_LETTER, worker);
    this.logger.info('Dead letter worker created');
  }

  private setupWorkerEvents(worker: Worker, queueName: string): void {
    worker.on('completed', (job) => {
      this.logger.debug('Job completed', {
        queue: queueName,
        jobId: job.id,
        duration: job.finishedOn !== undefined && job.processedOn !== undefined
          ? job.finishedOn - job.processedOn
          : 0,
      });
    });

    worker.on('failed', async (job, error) => {
      this.logger.error({
        queue: queueName,
        jobId: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
      }, 'Job failed');

      if (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        await this.moveToDeadLetter(job, error.message);
      }
    });

    worker.on('error', (error) => {
      this.logger.error({
        queue: queueName,
        error: error.message,
      }, 'Worker error');
    });

    worker.on('stalled', (jobId) => {
      this.logger.warn({
        queue: queueName,
        jobId,
      }, 'Job stalled');
    });
  }

  private async processMonitoringJob(job: Job<MonitoringJobData>): Promise<MonitoringResult> {
    const { skuId, retailer, productUrl, productId } = job.data;
    const metrics = getMetricsCollector();

    this.logger.debug('Processing monitoring job', {
      jobId: job.id,
      skuId,
      retailer,
    });

    const skuService = getSKUService();
    const monitoringService = getMonitoringService();
    const proxyManager = getProxyManager();
    const healthMonitor = getHealthMonitor();

    // Sticky proxy session keyed by SKU — persists across repeated checks
    const taskId = `monitor:${skuId}`;
    const allocation = proxyManager.allocate(taskId);

    const sku = await skuService.getById(skuId);
    if (sku === null) {
      throw new Error(`SKU not found: ${skuId}`);
    }

    // Run the browser-backed check inside the proxy context so BrowserManager
    // transparently applies the allocated proxy — no adapter changes needed.
    const result = await runWithProxyContext(
      { proxyUrl: allocation.proxyUrl, taskId },
      () => monitoringService.checkProduct(sku),
    );

    // ── Classify result and update proxy + health state ─────────────────────────
    if (result.error === null) {
      proxyManager.recordSuccess(taskId);
      healthMonitor.recordCheck(retailer, { responseMs: result.executionTimeMs });
    } else {
      const errLower = result.error.toLowerCase();
      const isCaptcha = /captcha|recaptcha|hcaptcha/.test(errLower);
      const isBlock   = /blocked|403|access denied|cloudflare|unusual traffic/.test(errLower);
      const isTimeout = /timeout|etimedout|navigation timeout/.test(errLower);
      const isRateLimit = /429|rate.?limit|too many requests/.test(errLower);

      if (isCaptcha) {
        proxyManager.recordFailure(taskId, RotationReason.CAPTCHA_ESCALATION);
        healthMonitor.recordCaptchaOrBlock(retailer, false);
      } else if (isBlock) {
        proxyManager.recordFailure(taskId, RotationReason.HARD_FAILURE);
        healthMonitor.recordCaptchaOrBlock(retailer, true);
      } else if (isRateLimit) {
        proxyManager.recordFailure(taskId, RotationReason.RATE_LIMITED);
      } else if (isTimeout) {
        proxyManager.recordFailure(taskId, RotationReason.TIMEOUT_ANOMALY);
      }

      healthMonitor.recordCheck(retailer, {
        responseMs: result.executionTimeMs,
        wasError:   !isCaptcha && !isBlock,
        wasCaptcha: isCaptcha,
        wasBlock:   isBlock,
        wasTimeout: isTimeout,
      });
    }

    // processCheckResult does only DB/alert work — runs outside proxy context
    await monitoringService.processCheckResult(result);

    if (monitoringService.shouldTriggerCheckout(result) && sku.autoCheckoutEnabled) {
      const queueManager = getQueueManager();
      await queueManager.addCheckoutJob({
        skuId,
        userId: (sku.metadata as Record<string, unknown>)?.userId as string ?? '',
        retailer,
        productUrl,
        productId,
        maxPrice: sku.targetPrice ?? undefined,
        triggeredBy: result.meetsTargetPrice ? 'price_drop' : 'stock_change',
      });

      this.logger.info('Checkout job triggered', {
        skuId,
        reason: result.meetsTargetPrice ? 'price_drop' : 'stock_change',
      });
    }

    metrics.incrementCounter(MetricNames.MONITORING_CHECKS);
    if (result.currentStatus === StockStatus.IN_STOCK) {
      metrics.incrementCounter(MetricNames.IN_STOCK_DETECTIONS);
    }

    return result;
  }

  private async processCheckoutJob(job: Job<CheckoutJobData>): Promise<void> {
    const { skuId, userId, retailer, maxPrice, quantity, triggeredBy } = job.data;
    const metrics = getMetricsCollector();

    this.logger.info('Processing checkout job', {
      jobId: job.id,
      skuId,
      retailer,
      triggeredBy,
    });

    const checkoutService = getCheckoutService();
    const proxyManager = getProxyManager();

    // Reuse the same sticky session as the monitoring job for this SKU so the
    // site sees the same IP for both the stock check and the checkout flow.
    const taskId = `monitor:${skuId}`;
    const allocation = proxyManager.allocate(taskId);

    try {
      const result = await runWithProxyContext(
        { proxyUrl: allocation.proxyUrl, taskId },
        () => checkoutService.attemptCheckout({ skuId, userId, maxPrice, quantity }),
      );

      if (result.status === CheckoutStatus.SUCCESS) {
        proxyManager.recordSuccess(taskId);
        metrics.incrementCounter(MetricNames.CHECKOUT_SUCCESSES);
      } else {
        // Checkout failure — keep proxy (may be a site issue, not IP-based)
        metrics.incrementCounter(MetricNames.CHECKOUT_FAILURES);
      }
    } catch (error) {
      metrics.incrementCounter(MetricNames.CHECKOUT_FAILURES);
      // Release proxy session on hard checkout failure so next attempt can
      // potentially get a fresh identity.
      proxyManager.release(taskId);
      throw error;
    }
  }

  private async processAlertJob(job: Job<AlertJobData>): Promise<void> {
    const { alertId, type, channels, payload } = job.data;

    this.logger.debug('Processing alert job', {
      jobId: job.id,
      alertId,
      type,
      channels,
    });

    for (const channel of channels) {
      await this.sendAlertToChannel(channel, type, payload);
    }
  }

  private async sendAlertToChannel(
    channel: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (channel) {
      case 'webhook':
        await this.sendWebhookAlert(payload);
        break;
      case 'email':
      case 'telegram':
      case 'discord': {
        // Route through the central notification service which handles retries,
        // channel config, and non-blocking dispatch.
        const notifier = getNotificationService();
        notifier.dispatch({
          eventType: String(payload['eventType'] ?? type),
          site: String(payload['site'] ?? payload['retailer'] ?? 'UNKNOWN'),
          productId: String(payload['productId'] ?? ''),
          productName: String(payload['productName'] ?? payload['skuId'] ?? ''),
          message: String(payload['message'] ?? type),
          timestamp: new Date().toISOString(),
          metadata: payload,
        });
        break;
      }
      default:
        this.logger.warn('Unknown alert channel', { channel });
    }
  }

  private async sendWebhookAlert(payload: Record<string, unknown>): Promise<void> {
    const webhookUrl = process.env['ALERT_WEBHOOK_URL'];
    if (webhookUrl === undefined) {
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed with status ${response.status}`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Webhook alert failed', err);
      throw error;
    }
  }

  private async processDeadLetterJob(job: Job): Promise<void> {
    this.logger.warn('Processing dead letter job', {
      jobId: job.id,
      data: job.data,
    });

    const errorService = getErrorService();
    await errorService.logError({
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      message: `Dead letter job: ${job.data.failedReason}`,
      context: {
        originalQueue: job.data.originalQueue,
        originalJobId: job.data.originalJobId,
        attemptsMade: job.data.attemptsMade,
        data: job.data.data,
      },
    });
  }

  private async moveToDeadLetter(job: Job, reason: string): Promise<void> {
    const queueManager = getQueueManager();
    await queueManager.addToDeadLetter({
      originalQueue: job.queueName,
      originalJobId: job.id ?? 'unknown',
      data: job.data,
      failedReason: reason,
      attemptsMade: job.attemptsMade,
      timestamp: Date.now(),
    });
  }
}

let workerManagerInstance: WorkerManager | null = null;

export function getWorkerManager(): WorkerManager {
  if (workerManagerInstance === null) {
    workerManagerInstance = new WorkerManagerImpl();
  }
  return workerManagerInstance;
}

export { WorkerManagerImpl };
