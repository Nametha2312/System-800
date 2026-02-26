/**
 * In-process monitoring poller.
 * Runs when Redis/BullMQ is unavailable (SKIP_REDIS_CONNECT=true).
 * Polls active SKUs on their configured intervals using the same adapter + service layer.
 *
 * Includes:
 *  - Heartbeat tracking: records timestamp of last successful check
 *  - Watchdog: detects stalls and attempts self-recovery every 60s
 *  - Health check registration: reports poller health to /health endpoint
 */

import { getDatabase } from '../persistence/database.js';
import { getSKURepository } from '../persistence/repositories/index.js';
import { getAdapterFactory } from '../adapters/factory.js';
import { getAlertService } from '../services/alert.service.js';
import { getLogger } from '../observability/logger.js';
import { getHealthCheck } from '../observability/health.js';
import { SKU, StockStatus, MonitoringStatus, AlertType, RetailerType } from '../types/index.js';

const logger = getLogger().child({ component: 'InProcessPoller' });

// ── Watchdog configuration ─────────────────────────────────────────────────
/** Max time (ms) without any successful check before the watchdog acts */
const STALL_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const WATCHDOG_INTERVAL_MS = 60 * 1000;    // check every 60 seconds
const SYNC_INTERVAL_MS = 30 * 1000;        // db sync every 30 seconds

interface ActiveJob {
  skuId: string;
  timer: NodeJS.Timeout;
  lastCheckAt: number;
  consecutiveErrors: number;
}

const activeJobs = new Map<string, ActiveJob>();
let lastGlobalHeartbeat = Date.now(); // updated on every successful check
let watchdogTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let isPollerRunning = false;

function parsePrice(val: unknown): number | null {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  }
  return null;
}

async function checkSKU(sku: SKU): Promise<void> {
  const factory = getAdapterFactory();
  const alertService = getAlertService();
  const db = getDatabase();

  try {
    const adapter = factory.getAdapter(sku.retailer as RetailerType);
    const result = await adapter.checkProduct(sku.productUrl);

    if (!result.success || !result.productInfo) {
      logger.warn('Check failed for SKU', { skuId: sku.id, error: result.error?.message });
      await db.query(
        `UPDATE skus SET consecutive_errors = consecutive_errors + 1, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [sku.id],
      );
      // Update job error counter but do NOT update the heartbeat — not a success
      const job = activeJobs.get(sku.id);
      if (job) job.consecutiveErrors = (job.consecutiveErrors ?? 0) + 1;
      return;
    }

    const info = result.productInfo;
    const newStatus = info.stockStatus;
    const newPrice = parsePrice(info.price);

    // ── Data integrity: never overwrite a valid known price with null ────────
    const resolvedPrice = newPrice !== null ? newPrice : sku.currentPrice;

    // ── Data integrity: don't overwrite a real status with UNKNOWN ───────────
    const resolvedStatus =
      newStatus === StockStatus.UNKNOWN && sku.currentStockStatus !== StockStatus.UNKNOWN
        ? sku.currentStockStatus
        : newStatus;

    // Update SKU in DB
    await db.query(
      `UPDATE skus
       SET current_stock_status = $1,
           current_price = $2,
           last_checked_at = NOW(),
           consecutive_errors = 0,
           updated_at = NOW()
       WHERE id = $3`,
      [resolvedStatus, resolvedPrice, sku.id],
    );

    // Update heartbeat on every successful DB write
    lastGlobalHeartbeat = Date.now();
    const job = activeJobs.get(sku.id);
    if (job) {
      job.lastCheckAt = Date.now();
      job.consecutiveErrors = 0;
    }

    const statusChanged = resolvedStatus !== sku.currentStockStatus;
    const priceChanged =
      resolvedPrice !== null && sku.currentPrice !== null && resolvedPrice !== sku.currentPrice;

    // Create alert if stock came in
    if (statusChanged && resolvedStatus === StockStatus.IN_STOCK) {
      const priceText = resolvedPrice !== null ? ` at $${resolvedPrice.toFixed(2)}` : '';
      await alertService.createAlert({
        skuId: sku.id,
        type: AlertType.STOCK_AVAILABLE,
        title: `🟢 ${info.name || sku.productId} is IN STOCK`,
        message: `${sku.retailer} – ${sku.productUrl}${priceText}. Auto-checkout: ${sku.autoCheckoutEnabled ? 'enabled' : 'disabled'}.`,
        metadata: { previousStatus: sku.currentStockStatus, newStatus: resolvedStatus, price: resolvedPrice },
      });

      logger.info('STOCK AVAILABLE alert created', {
        skuId: sku.id,
        retailer: sku.retailer,
        price: resolvedPrice,
      });

      // Trigger auto-checkout if enabled
      if (sku.autoCheckoutEnabled) {
        await triggerAutoCheckout(sku, resolvedPrice);
      }
    }

    // Price drop alert
    if (priceChanged && resolvedPrice! < sku.currentPrice!) {
      await alertService.createAlert({
        skuId: sku.id,
        type: AlertType.PRICE_DROP,
        title: `💰 Price Drop: ${info.name || sku.productId}`,
        message: `Price dropped from $${sku.currentPrice!.toFixed(2)} to $${resolvedPrice!.toFixed(2)} on ${sku.retailer}.`,
        metadata: { previousPrice: sku.currentPrice, newPrice: resolvedPrice },
      });
    }

    // Price increase alert
    if (priceChanged && resolvedPrice! > sku.currentPrice!) {
      await alertService.createAlert({
        skuId: sku.id,
        type: AlertType.PRICE_INCREASE,
        title: `📈 Price Increase: ${info.name || sku.productId}`,
        message: `Price increased from $${sku.currentPrice!.toFixed(2)} to $${resolvedPrice!.toFixed(2)} on ${sku.retailer}.`,
        metadata: { previousPrice: sku.currentPrice, newPrice: resolvedPrice },
      });
    }

    logger.debug('SKU check complete', {
      skuId: sku.id,
      status: resolvedStatus,
      price: resolvedPrice,
      statusChanged,
    });
  } catch (err) {
    logger.error({
      skuId: sku.id,
      error: err instanceof Error ? err.message : String(err),
    }, 'Error checking SKU');
    await db.query(
      `UPDATE skus SET consecutive_errors = consecutive_errors + 1, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [sku.id],
    );
  }
}

async function triggerAutoCheckout(sku: SKU, price: number | null): Promise<void> {
  const alertService = getAlertService();
  const db = getDatabase();

  // Check price vs target before attempting
  if (sku.targetPrice !== null && price !== null && price > sku.targetPrice) {
    logger.info('Skipping auto-checkout: price above target', {
      skuId: sku.id,
      price,
      targetPrice: sku.targetPrice,
    });
    return;
  }

  logger.info('Triggering auto-checkout for SKU', { skuId: sku.id });

  try {
    // Record checkout attempt
    await db.query(
      `INSERT INTO checkout_attempts
         (sku_id, credential_id, status, started_at, current_step, step_history, created_at, updated_at)
       SELECT $1, rc.id, 'PENDING', NOW(), 'initiated', '[]'::jsonb, NOW(), NOW()
       FROM retailer_credentials rc
       WHERE rc.retailer = $2 AND rc.is_valid = true
       LIMIT 1`,
      [sku.id, sku.retailer],
    );

    await alertService.createAlert({
      skuId: sku.id,
      type: AlertType.CHECKOUT_SUCCESS,
      title: `🛒 Auto-Checkout Initiated: ${sku.productId}`,
      message: `Auto-checkout has been triggered for ${sku.retailer}. Check the Checkouts page for status.`,
      metadata: { price, retailer: sku.retailer },
    });
  } catch (err) {
    logger.error({
      skuId: sku.id,
      error: err instanceof Error ? err.message : String(err),
    }, 'Failed to initiate auto-checkout');

    await alertService.createAlert({
      skuId: sku.id,
      type: AlertType.CHECKOUT_FAILED,
      title: `❌ Auto-Checkout Failed: ${sku.productId}`,
      message: `Could not initiate checkout on ${sku.retailer}. Make sure your retailer credentials are saved.`,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

async function getActiveSKUs(): Promise<SKU[]> {
  const skuRepository = getSKURepository();
  return skuRepository.findActiveForMonitoring();
}

function scheduleSKU(sku: SKU): void {
  // Cancel existing job if any
  unscheduleSKU(sku.id);

  const interval = Math.max(sku.pollingIntervalMs ?? 30000, 10000);

  // Run immediately, then on interval
  void checkSKU(sku);

  const timer = setInterval(() => {
    void checkSKU(sku);
  }, interval);

  activeJobs.set(sku.id, {
    skuId: sku.id,
    timer,
    lastCheckAt: Date.now(),
    consecutiveErrors: 0,
  });
  logger.info('SKU polling scheduled', { skuId: sku.id, intervalMs: interval });
}

function unscheduleSKU(skuId: string): void {
  const job = activeJobs.get(skuId);
  if (job) {
    clearInterval(job.timer);
    activeJobs.delete(skuId);
    logger.debug('SKU polling unscheduled', { skuId });
  }
}

export async function startInProcessPoller(): Promise<void> {
  logger.info('Starting in-process monitoring poller');
  isPollerRunning = true;
  lastGlobalHeartbeat = Date.now();

  // Load all active SKUs and schedule them
  try {
    const skus = await getActiveSKUs();
    for (const sku of skus) {
      scheduleSKU(sku);
    }
    logger.info('In-process poller started', { activeSKUs: skus.length });
  } catch (err) {
    logger.warn('Could not load active SKUs on startup (DB may not be ready)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Periodic sync: pick up newly activated SKUs every 30s
  syncTimer = setInterval(async () => {
    try {
      const skus = await getActiveSKUs();
      const currentIds = new Set(skus.map((s) => s.id));

      // Schedule any new/untracked active SKUs
      for (const sku of skus) {
        if (!activeJobs.has(sku.id)) {
          scheduleSKU(sku);
        }
      }

      // Stop jobs for SKUs that are no longer active
      for (const id of activeJobs.keys()) {
        if (!currentIds.has(id)) {
          unscheduleSKU(id);
        }
      }
    } catch (err) {
      logger.warn('Poller sync error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, SYNC_INTERVAL_MS);

  // Watchdog: detect stalls and attempt self-recovery
  watchdogTimer = setInterval(async () => {
    const timeSinceLastBeat = Date.now() - lastGlobalHeartbeat;
    const activeCount = activeJobs.size;

    if (activeCount === 0) {
      // No SKUs to monitor ─ this is normal, not a stall
      return;
    }

    if (timeSinceLastBeat > STALL_THRESHOLD_MS) {
      logger.error('Poller stall detected — attempting self-recovery', {
        timeSinceLastBeatMs: timeSinceLastBeat,
        activeJobs: activeCount,
        stallThresholdMs: STALL_THRESHOLD_MS,
      });

      // Clear all existing jobs and re-schedule from DB
      for (const id of [...activeJobs.keys()]) {
        unscheduleSKU(id);
      }

      try {
        const skus = await getActiveSKUs();
        for (const sku of skus) {
          scheduleSKU(sku);
        }
        lastGlobalHeartbeat = Date.now();
        logger.info('Poller self-recovery complete', { rescheduled: skus.length });
      } catch (recoveryErr) {
        logger.error('Poller self-recovery failed', {
          error: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
        });
      }
    } else {
      logger.debug('Poller watchdog OK', {
        activeJobs: activeCount,
        timeSinceLastBeatMs: timeSinceLastBeat,
      });
    }
  }, WATCHDOG_INTERVAL_MS);

  // Register health check so /health reports poller status
  const healthCheck = getHealthCheck();
  healthCheck.register('poller', async () => {
    const timeSince = Date.now() - lastGlobalHeartbeat;
    const active = activeJobs.size;
    const isStalled = active > 0 && timeSince > STALL_THRESHOLD_MS;

    return {
      name: 'poller',
      status: isPollerRunning ? (isStalled ? 'degraded' : 'healthy') : 'unhealthy',
      message: isPollerRunning
        ? `Active: ${active} SKUs, last heartbeat ${Math.round(timeSince / 1000)}s ago${isStalled ? ' — STALLED' : ''}`
        : 'Poller is not running',
      lastCheckedAt: new Date(lastGlobalHeartbeat),
      latencyMs: timeSince,
    };
  });
}

export function stopInProcessPoller(): void {
  isPollerRunning = false;
  for (const id of activeJobs.keys()) {
    unscheduleSKU(id);
  }
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  logger.info('In-process poller stopped');
}

/** Called by the SKU service / API routes when status changes */
export function notifyPollerSKUActivated(sku: SKU): void {
  scheduleSKU(sku);
}

export function notifyPollerSKUDeactivated(skuId: string): void {
  unscheduleSKU(skuId);
}

export function getPollerStatus(): { skuId: string; lastCheckAt: number }[] {
  return Array.from(activeJobs.values()).map((j) => ({
    skuId: j.skuId,
    lastCheckAt: j.lastCheckAt,
  }));
}

export function getPollerHeartbeat(): { lastGlobalHeartbeat: number; activeJobs: number; isRunning: boolean } {
  return {
    lastGlobalHeartbeat,
    activeJobs: activeJobs.size,
    isRunning: isPollerRunning,
  };
}