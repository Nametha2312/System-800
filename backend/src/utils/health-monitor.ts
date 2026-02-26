/**
 * Health Monitor — Lightweight per-retailer failure awareness
 *
 * Aggregates check outcomes in a rolling window per retailer and evaluates
 * them against configurable thresholds. When a threshold breach is detected
 * it:
 *   1. Updates the retailer health status (healthy / degraded / unreachable)
 *   2. Emits a structured log entry
 *   3. Dispatches an external notification (with per-retailer cooldown to
 *      prevent alert storms)
 *
 * Integration points (all additive, no existing logic modified):
 *   • workers.ts  — calls recordCheck() after every monitoring job result
 *   • workers.ts  — calls recordCaptchaOrBlock() when CaptchaDetectedError fires
 *   • proxy-manager.ts — calls recordProxyExhaustion() on pool exhaustion
 *
 * This module is intentionally stateless beyond its in-memory rolling window —
 * no database writes, no heavy aggregations, no intervals.
 */

import { RetailerType } from '../types/index.js';
import { getLogger } from '../observability/logger.js';
import { getNotificationService } from '../services/notification.service.js';

const logger = getLogger().child({ component: 'HealthMonitor' });

// ---------------------------------------------------------------------------
// Constants / thresholds
// ---------------------------------------------------------------------------

const WINDOW_SIZE      = 20;   // number of recent checks per retailer
const CAPTCHA_RATE_THRESHOLD   = 0.30;  // 30 % captcha rate → degraded
const ERROR_RATE_THRESHOLD     = 0.50;  // 50 % error rate  → degraded
const SLOW_RESPONSE_THRESHOLD_MS = 12_000; // avg ms above this → warn
const CONSECUTIVE_FAIL_UNREACHABLE = 5;    // consecutive failures → unreachable
const NOTIFY_COOLDOWN_MS       = 15 * 60 * 1_000; // 15 min per retailer

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthStatus = 'healthy' | 'degraded' | 'unreachable';

export interface CheckRecord {
  readonly timestamp: number;        // epoch ms
  readonly responseMs: number;
  readonly wasCaptcha: boolean;
  readonly wasTimeout: boolean;
  readonly wasError: boolean;
  readonly wasBlock: boolean;
}

export interface RetailerHealthSnapshot {
  readonly retailer: string;
  readonly status: HealthStatus;
  readonly windowSize: number;
  readonly errorRate: number;
  readonly captchaRate: number;
  readonly avgResponseMs: number;
  readonly consecutiveFailures: number;
  readonly lastCheckedAt: number | null;
  readonly lastNotifiedAt: number | null;
}

export interface HealthMonitor {
  /**
   * Record the outcome of a single monitoring check.
   * Called by the monitoring worker after every adapter.checkProduct() call.
   */
  recordCheck(
    retailer: RetailerType | string,
    data: {
      responseMs: number;
      wasError?: boolean;
      wasTimeout?: boolean;
      wasCaptcha?: boolean;
      wasBlock?: boolean;
    },
  ): void;

  /** Convenience recorder for captcha / block events raised by captcha-detector */
  recordCaptchaOrBlock(retailer: RetailerType | string, isBlock: boolean): void;

  /** Called when proxy pool is fully exhausted for a retailer */
  recordProxyExhaustion(retailer: RetailerType | string): void;

  /** Returns the current health snapshot for a retailer */
  getStatus(retailer: RetailerType | string): RetailerHealthSnapshot;

  /** Returns true when the retailer is currently considered healthy */
  isHealthy(retailer: RetailerType | string): boolean;

  /** Full snapshot of all tracked retailers */
  getAllStatuses(): RetailerHealthSnapshot[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface RetailerState {
  window: CheckRecord[];
  consecutiveFailures: number;
  status: HealthStatus;
  lastNotifiedAt: number | null;
}

class HealthMonitorImpl implements HealthMonitor {
  private readonly state: Map<string, RetailerState> = new Map();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  recordCheck(
    retailer: RetailerType | string,
    data: {
      responseMs: number;
      wasError?: boolean;
      wasTimeout?: boolean;
      wasCaptcha?: boolean;
      wasBlock?: boolean;
    },
  ): void {
    const key = String(retailer);
    const state = this.ensureState(key);
    const now = Date.now();

    const record: CheckRecord = {
      timestamp: now,
      responseMs: data.responseMs,
      wasCaptcha: data.wasCaptcha ?? false,
      wasTimeout: data.wasTimeout ?? false,
      wasError: data.wasError ?? false,
      wasBlock: data.wasBlock ?? false,
    };

    // Maintain rolling window
    state.window.push(record);
    if (state.window.length > WINDOW_SIZE) {
      state.window.shift();
    }

    // Update consecutive failure streak
    const isFail = record.wasError || record.wasTimeout || record.wasBlock;
    if (isFail) {
      state.consecutiveFailures++;
    } else {
      state.consecutiveFailures = 0;
    }

    this.evaluate(key, state);
  }

  recordCaptchaOrBlock(retailer: RetailerType | string, isBlock: boolean): void {
    this.recordCheck(retailer, {
      responseMs: 0,
      wasCaptcha: !isBlock,
      wasBlock: isBlock,
      wasError: false,
      wasTimeout: false,
    });
  }

  recordProxyExhaustion(retailer: RetailerType | string): void {
    const key = String(retailer);
    logger.warn('Proxy pool exhausted for retailer', { site: key });
    this.maybeNotify(key, this.ensureState(key), 'PROXY_EXHAUSTED', 'degraded');
  }

  getStatus(retailer: RetailerType | string): RetailerHealthSnapshot {
    const key = String(retailer);
    const state = this.state.get(key);
    if (state === undefined) {
      return this.emptySnapshot(key);
    }
    return this.buildSnapshot(key, state);
  }

  isHealthy(retailer: RetailerType | string): boolean {
    return this.getStatus(retailer).status === 'healthy';
  }

  getAllStatuses(): RetailerHealthSnapshot[] {
    const result: RetailerHealthSnapshot[] = [];
    for (const [key, state] of this.state.entries()) {
      result.push(this.buildSnapshot(key, state));
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureState(key: string): RetailerState {
    let state = this.state.get(key);
    if (state === undefined) {
      state = { window: [], consecutiveFailures: 0, status: 'healthy', lastNotifiedAt: null };
      this.state.set(key, state);
    }
    return state;
  }

  /**
   * Evaluate the current rolling window and update status.
   * Trigger notifications when thresholds are breached (with cooldown).
   */
  private evaluate(key: string, state: RetailerState): void {
    const w = state.window;
    if (w.length === 0) return;

    const errorCount   = w.filter((r) => r.wasError || r.wasBlock).length;
    const captchaCount = w.filter((r) => r.wasCaptcha).length;
    const timeoutCount = w.filter((r) => r.wasTimeout).length;
    const totalMs      = w.reduce((s, r) => s + r.responseMs, 0);
    const avgResponseMs = totalMs / w.length;

    const errorRate   = errorCount   / w.length;
    const captchaRate = captchaCount / w.length;

    let newStatus: HealthStatus = 'healthy';
    let eventType: string | null = null;
    let eventMsg: string | null = null;

    if (state.consecutiveFailures >= CONSECUTIVE_FAIL_UNREACHABLE) {
      newStatus = 'unreachable';
      eventType = 'SITE_UNREACHABLE';
      eventMsg  = `${key} appears unreachable — ${state.consecutiveFailures} consecutive failures.`;
    } else if (errorRate >= ERROR_RATE_THRESHOLD) {
      newStatus = 'degraded';
      eventType = 'HIGH_ERROR_RATE';
      eventMsg  = `${key} error rate ${(errorRate * 100).toFixed(0)}% exceeds threshold (${ERROR_RATE_THRESHOLD * 100}%).`;
    } else if (captchaRate >= CAPTCHA_RATE_THRESHOLD) {
      newStatus = 'degraded';
      eventType = 'CAPTCHA_SPIKE';
      eventMsg  = `${key} captcha rate ${(captchaRate * 100).toFixed(0)}% — possible detection escalation.`;
    }

    if (avgResponseMs > SLOW_RESPONSE_THRESHOLD_MS && newStatus === 'healthy') {
      logger.warn('Slow response detected', { site: key, avgResponseMs });
    }

    if (timeoutCount >= 3 && newStatus === 'healthy') {
      logger.warn('Timeout cluster detected', { site: key, timeoutCount, windowSize: w.length });
    }

    const statusChanged = newStatus !== state.status;
    state.status = newStatus;

    if (eventType !== null && eventMsg !== null) {
      if (statusChanged) {
        logger.warn('Retailer health status changed', {
          site: key,
          status: newStatus,
          errorRate: errorRate.toFixed(2),
          captchaRate: captchaRate.toFixed(2),
          avgResponseMs,
        });
      }
      this.maybeNotify(key, state, eventType, newStatus, {
        errorRate, captchaRate, avgResponseMs,
        windowSize: w.length, consecutiveFailures: state.consecutiveFailures,
      });
    } else if (statusChanged && newStatus === 'healthy') {
      // Recovery
      logger.info('Retailer health recovered', { site: key });
    }
  }

  /**
   * Dispatch a notification only if the cooldown has elapsed for this retailer.
   */
  private maybeNotify(
    retailer: string,
    state: RetailerState,
    eventType: string,
    healthStatus: HealthStatus,
    metadata?: Record<string, unknown>,
  ): void {
    const now = Date.now();
    if (state.lastNotifiedAt !== null && now - state.lastNotifiedAt < NOTIFY_COOLDOWN_MS) {
      return; // on cooldown — skip
    }
    state.lastNotifiedAt = now;

    try {
      const notifier = getNotificationService();
      notifier.dispatch({
        eventType,
        site: retailer,
        productId: '',
        productName: '',
        message: `Health alert for ${retailer}: ${eventType} (status: ${healthStatus})`,
        timestamp: new Date().toISOString(),
        metadata: {
          healthStatus,
          ...metadata,
        },
      });
    } catch {
      // Notification failures must never propagate
    }
  }

  private buildSnapshot(key: string, state: RetailerState): RetailerHealthSnapshot {
    const w = state.window;
    if (w.length === 0) return this.emptySnapshot(key);

    const errorCount   = w.filter((r) => r.wasError || r.wasBlock).length;
    const captchaCount = w.filter((r) => r.wasCaptcha).length;
    const totalMs      = w.reduce((s, r) => s + r.responseMs, 0);
    const lastRecord   = w[w.length - 1];

    return {
      retailer: key,
      status: state.status,
      windowSize: w.length,
      errorRate: errorCount / w.length,
      captchaRate: captchaCount / w.length,
      avgResponseMs: totalMs / w.length,
      consecutiveFailures: state.consecutiveFailures,
      lastCheckedAt: lastRecord?.timestamp ?? null,
      lastNotifiedAt: state.lastNotifiedAt,
    };
  }

  private emptySnapshot(retailer: string): RetailerHealthSnapshot {
    return {
      retailer,
      status: 'healthy',
      windowSize: 0,
      errorRate: 0,
      captchaRate: 0,
      avgResponseMs: 0,
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastNotifiedAt: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: HealthMonitor | null = null;

export function getHealthMonitor(): HealthMonitor {
  if (instance === null) {
    instance = new HealthMonitorImpl();
  }
  return instance;
}

export function resetHealthMonitor(): void {
  instance = null;
}

export { HealthMonitorImpl, WINDOW_SIZE, CAPTCHA_RATE_THRESHOLD, ERROR_RATE_THRESHOLD };
