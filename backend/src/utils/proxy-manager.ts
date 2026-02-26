/**
 * Proxy Manager — Intelligent proxy lifecycle management
 *
 * Design principles:
 *  • Per-task sticky sessions  — a given task reuses the same proxy to maintain
 *    identity continuity across page loads within a monitoring or checkout flow.
 *  • Controlled rotation       — rotation is event-driven, never naive random.
 *  • Anti-thrashing            — enforces a minimum interval between rotations
 *    and a per-session cap to prevent identity churn and detection escalation.
 *  • Graceful degradation      — if all proxies are exhausted/quarantined the
 *    system falls back to a direct connection and logs a warning.
 *  • Quarantine model          — hard-blocked proxies are taken out of
 *    circulation for a configurable period before being retried.
 *
 * Rotation triggers (RotationReason enum):
 *  HARD_FAILURE       — 403 / IP-banned / site explicitly blocked IP
 *  CAPTCHA_ESCALATION — recurring CAPTCHA on same proxy (not a one-off)
 *  RATE_LIMITED       — 429 / too-many-requests
 *  TIMEOUT_ANOMALY    — consecutive anomalous timeouts on the same proxy
 *  SOFT_BLOCK         — generic soft signal (bot page, unusual-traffic notice)
 *
 * Configuration via environment variables (see config/index.ts):
 *  PROXY_ENABLED                   boolean  default: false
 *  PROXY_POOL                      string   comma-separated proxy URLs
 *  PROXY_ROTATION_MODE             string   "soft" | "aggressive" default: "soft"
 *  PROXY_MIN_ROTATION_INTERVAL_MS  number   default: 30 000
 *  PROXY_QUARANTINE_DURATION_MS    number   default: 600 000 (10 min)
 *  PROXY_MAX_ROTATIONS_PER_TASK    number   default: 5
 */

import { getLogger } from '../observability/logger.js';
import { getConfig } from '../config/index.js';

const logger = getLogger().child({ component: 'ProxyManager' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum RotationReason {
  HARD_FAILURE       = 'HARD_FAILURE',
  CAPTCHA_ESCALATION = 'CAPTCHA_ESCALATION',
  RATE_LIMITED       = 'RATE_LIMITED',
  TIMEOUT_ANOMALY    = 'TIMEOUT_ANOMALY',
  SOFT_BLOCK         = 'SOFT_BLOCK',
  MANUAL             = 'MANUAL',
}

interface ProxyEntry {
  readonly url: string;
  failureCount: number;
  captchaCount: number;
  successCount: number;
  isQuarantined: boolean;
  quarantineUntil: number | null;   // epoch ms
  lastFailureAt: number | null;
  lastUsedAt: number | null;
}

interface StickySession {
  readonly taskId: string;
  proxyUrl: string | null;          // null = direct
  assignedAt: number;
  rotationCount: number;
  lastRotatedAt: number | null;
  consecutiveTimeouts: number;
  captchaCount: number;
}

export interface ProxyAllocation {
  /** Proxy URL or null if using direct connection */
  readonly proxyUrl: string | null;
  /** Whether this is a proxy-backed connection */
  readonly isProxied: boolean;
  /** Label for logging */
  readonly label: string;
}

export interface ProxyManager {
  /**
   * Allocate (or recall the sticky) proxy for a task.
   * Returns null proxyUrl when operating in direct (no-proxy) mode.
   */
  allocate(taskId: string): ProxyAllocation;

  /**
   * Rotate the proxy for a task.  Applies anti-thrashing rules.
   * Returns the new allocation (may be null if pool exhausted).
   */
  rotate(taskId: string, reason: RotationReason): ProxyAllocation;

  /** Record a successful page load on the current task proxy */
  recordSuccess(taskId: string): void;

  /** Record a failure event — may trigger automatic quarantine */
  recordFailure(taskId: string, reason: RotationReason): void;

  /** Release the sticky session when a task finishes */
  release(taskId: string): void;

  /** True when proxy mode is active and at least one healthy proxy exists */
  isEnabled(): boolean;

  /** Debug snapshot of current pool state */
  getPoolStatus(): ProxyPoolStatus;
}

export interface ProxyPoolStatus {
  readonly enabled: boolean;
  readonly total: number;
  readonly healthy: number;
  readonly quarantined: number;
  readonly activeSessions: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ProxyManagerImpl implements ProxyManager {
  private readonly pool: Map<string, ProxyEntry> = new Map();
  private readonly sessions: Map<string, StickySession> = new Map();
  private enabled: boolean = false;

  // Config driven at construction time
  private readonly mode: 'soft' | 'aggressive';
  private readonly minRotationIntervalMs: number;
  private readonly quarantineDurationMs: number;
  private readonly maxRotationsPerTask: number;

  constructor() {
    const cfg = this.loadConfig();
    this.enabled = cfg.enabled;
    this.mode = cfg.mode;
    this.minRotationIntervalMs = cfg.minRotationIntervalMs;
    this.quarantineDurationMs = cfg.quarantineDurationMs;
    this.maxRotationsPerTask = cfg.maxRotationsPerTask;

    if (this.enabled) {
      this.initPool(cfg.pool);
      logger.info('Proxy manager initialised', {
        total: this.pool.size,
        mode: this.mode,
        minRotationIntervalMs: this.minRotationIntervalMs,
        maxRotationsPerTask: this.maxRotationsPerTask,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  allocate(taskId: string): ProxyAllocation {
    if (!this.enabled) return direct();

    // Return existing sticky session
    const existing = this.sessions.get(taskId);
    if (existing !== undefined) {
      if (existing.proxyUrl === null) return direct();
      const entry = this.pool.get(existing.proxyUrl);
      if (entry !== undefined && !this.isQuarantined(entry)) {
        return toAllocation(existing.proxyUrl);
      }
      // Sticky proxy became quarantined — rotate immediately
      return this.rotate(taskId, RotationReason.HARD_FAILURE);
    }

    // New session — pick best available proxy
    const proxy = this.pickBest();
    const proxyUrl = proxy?.url ?? null;

    const session: StickySession = {
      taskId,
      proxyUrl,
      assignedAt: Date.now(),
      rotationCount: 0,
      lastRotatedAt: null,
      consecutiveTimeouts: 0,
      captchaCount: 0,
    };
    this.sessions.set(taskId, session);

    if (proxyUrl !== null) {
      const entry = this.pool.get(proxyUrl);
      if (entry !== undefined) entry.lastUsedAt = Date.now();
      logger.debug('Proxy allocated', { taskId, proxyUrl: sanitiseUrl(proxyUrl) });
    } else {
      logger.warn('Proxy pool exhausted — task using direct connection', { taskId });
    }

    return proxyUrl !== null ? toAllocation(proxyUrl) : direct();
  }

  rotate(taskId: string, reason: RotationReason): ProxyAllocation {
    if (!this.enabled) return direct();

    const session = this.sessions.get(taskId);
    if (session === undefined) return this.allocate(taskId);

    const now = Date.now();

    // --- Anti-thrashing: honour minimum rotation interval ---
    if (
      session.lastRotatedAt !== null &&
      now - session.lastRotatedAt < this.minRotationIntervalMs
    ) {
      logger.debug('Rotation throttled (min interval not elapsed)', {
        taskId,
        reason,
        msRemaining: this.minRotationIntervalMs - (now - session.lastRotatedAt),
      });
      return session.proxyUrl !== null ? toAllocation(session.proxyUrl) : direct();
    }

    // --- Anti-thrashing: cap total rotations per task ---
    if (session.rotationCount >= this.maxRotationsPerTask) {
      logger.warn('Max rotations reached — task falling back to direct connection', {
        taskId,
        reason,
        rotationCount: session.rotationCount,
      });
      this.updateSession(taskId, { proxyUrl: null, lastRotatedAt: now });
      return direct();
    }

    // --- Handle current proxy ---
    if (session.proxyUrl !== null) {
      const entry = this.pool.get(session.proxyUrl);
      if (entry !== undefined) {
        this.applyFailurePolicy(entry, reason, now);
      }
    }

    // --- Pick next proxy (excluding current) ---
    const excluded = session.proxyUrl;
    const next = this.pickBest(excluded);

    const newProxyUrl = next?.url ?? null;
    this.updateSession(taskId, {
      proxyUrl: newProxyUrl,
      rotationCount: session.rotationCount + 1,
      lastRotatedAt: now,
      consecutiveTimeouts: 0,
    });

    logger.info('Proxy rotated', {
      taskId,
      reason,
      from: excluded !== null ? sanitiseUrl(excluded) : 'direct',
      to: newProxyUrl !== null ? sanitiseUrl(newProxyUrl) : 'direct',
      rotationCount: session.rotationCount + 1,
    });

    if (newProxyUrl !== null) {
      const entry = this.pool.get(newProxyUrl);
      if (entry !== undefined) entry.lastUsedAt = now;
    }

    return newProxyUrl !== null ? toAllocation(newProxyUrl) : direct();
  }

  recordSuccess(taskId: string): void {
    const session = this.sessions.get(taskId);
    if (session?.proxyUrl == null) return;

    const entry = this.pool.get(session.proxyUrl);
    if (entry === undefined) return;

    entry.successCount++;
    entry.failureCount = Math.max(0, entry.failureCount - 1); // decay failure count on success
    this.updateSession(taskId, { consecutiveTimeouts: 0 });
  }

  recordFailure(taskId: string, reason: RotationReason): void {
    const session = this.sessions.get(taskId);
    if (session === undefined) return;

    // Track consecutive timeouts for anomaly detection
    if (reason === RotationReason.TIMEOUT_ANOMALY) {
      const newCount = session.consecutiveTimeouts + 1;
      this.updateSession(taskId, { consecutiveTimeouts: newCount });

      // Only rotate after two consecutive timeout anomalies (soft mode) or one (aggressive)
      const threshold = this.mode === 'aggressive' ? 1 : 2;
      if (newCount >= threshold) {
        logger.debug('Timeout anomaly threshold reached — rotating proxy', { taskId, newCount });
        this.rotate(taskId, RotationReason.TIMEOUT_ANOMALY);
      }
      return;
    }

    if (reason === RotationReason.CAPTCHA_ESCALATION) {
      const newCount = session.captchaCount + 1;
      this.updateSession(taskId, { captchaCount: newCount });

      // In soft mode tolerate 1 captcha before rotating; aggressive rotates immediately
      const threshold = this.mode === 'aggressive' ? 1 : 2;
      if (newCount >= threshold) {
        logger.debug('Captcha escalation threshold reached — rotating proxy', { taskId, newCount });
        this.rotate(taskId, RotationReason.CAPTCHA_ESCALATION);
      }
      return;
    }

    // All other failure reasons trigger rotation immediately
    this.rotate(taskId, reason);
  }

  release(taskId: string): void {
    this.sessions.delete(taskId);
  }

  isEnabled(): boolean {
    if (!this.enabled) return false;
    return this.countHealthy() > 0;
  }

  getPoolStatus(): ProxyPoolStatus {
    const now = Date.now();
    let quarantined = 0;
    for (const entry of this.pool.values()) {
      if (this.isQuarantined(entry, now)) quarantined++;
    }
    return {
      enabled: this.enabled,
      total: this.pool.size,
      healthy: this.pool.size - quarantined,
      quarantined,
      activeSessions: this.sessions.size,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private loadConfig() {
    try {
      const cfg = getConfig();
      const proxyCfg = cfg.proxy;
      return {
        enabled: proxyCfg.enabled,
        pool: proxyCfg.pool,
        mode: proxyCfg.rotationMode,
        minRotationIntervalMs: proxyCfg.minRotationIntervalMs,
        quarantineDurationMs: proxyCfg.quarantineDurationMs,
        maxRotationsPerTask: proxyCfg.maxRotationsPerTask,
      };
    } catch {
      // Config not ready in test environment
      return {
        enabled: false,
        pool: [] as string[],
        mode: 'soft' as const,
        minRotationIntervalMs: 30_000,
        quarantineDurationMs: 600_000,
        maxRotationsPerTask: 5,
      };
    }
  }

  private initPool(urls: string[]): void {
    for (const url of urls) {
      const trimmed = url.trim();
      if (trimmed.length === 0) continue;
      this.pool.set(trimmed, {
        url: trimmed,
        failureCount: 0,
        captchaCount: 0,
        successCount: 0,
        isQuarantined: false,
        quarantineUntil: null,
        lastFailureAt: null,
        lastUsedAt: null,
      });
    }
  }

  /**
   * Apply quarantine or failure scoring to a proxy based on rotation reason.
   */
  private applyFailurePolicy(entry: ProxyEntry, reason: RotationReason, now: number): void {
    entry.failureCount++;
    entry.lastFailureAt = now;

    switch (reason) {
      case RotationReason.HARD_FAILURE:
        // Full quarantine
        entry.isQuarantined = true;
        entry.quarantineUntil = now + this.quarantineDurationMs;
        logger.warn('Proxy quarantined (hard failure)', {
          proxy: sanitiseUrl(entry.url),
          until: new Date(entry.quarantineUntil).toISOString(),
        });
        break;

      case RotationReason.RATE_LIMITED:
        // Shorter quarantine for rate limiting (allow retry sooner)
        entry.isQuarantined = true;
        entry.quarantineUntil = now + Math.min(this.quarantineDurationMs, 180_000);
        logger.warn('Proxy quarantined (rate-limited)', {
          proxy: sanitiseUrl(entry.url),
          durationMs: entry.quarantineUntil - now,
        });
        break;

      case RotationReason.CAPTCHA_ESCALATION:
      case RotationReason.TIMEOUT_ANOMALY:
      case RotationReason.SOFT_BLOCK:
        // Soft failure: just bump the failure counter (no quarantine unless repeated)
        if (entry.failureCount >= 5) {
          entry.isQuarantined = true;
          entry.quarantineUntil = now + Math.floor(this.quarantineDurationMs / 2);
          logger.warn('Proxy quarantined (repeated soft failures)', {
            proxy: sanitiseUrl(entry.url),
            failureCount: entry.failureCount,
          });
        }
        break;

      default:
        break;
    }
  }

  /**
   * Pick the healthiest available proxy, optionally excluding one URL.
   * Selection preference: fewest failures, then least recently used.
   */
  private pickBest(exclude?: string | null): ProxyEntry | null {
    const now = Date.now();
    let best: ProxyEntry | null = null;

    for (const entry of this.pool.values()) {
      if (entry.url === exclude) continue;
      if (this.isQuarantined(entry, now)) continue;

      if (best === null) {
        best = entry;
        continue;
      }

      // Prefer lower failure count, then prefer lest-recently-used
      if (entry.failureCount < best.failureCount) {
        best = entry;
      } else if (
        entry.failureCount === best.failureCount &&
        (entry.lastUsedAt ?? 0) < (best.lastUsedAt ?? 0)
      ) {
        best = entry;
      }
    }

    return best;
  }

  private isQuarantined(entry: ProxyEntry, now = Date.now()): boolean {
    if (!entry.isQuarantined) return false;
    if (entry.quarantineUntil !== null && now >= entry.quarantineUntil) {
      // Auto-lift quarantine
      entry.isQuarantined = false;
      entry.quarantineUntil = null;
      entry.failureCount = Math.floor(entry.failureCount / 2); // partial forgiveness
      logger.info('Proxy quarantine lifted', { proxy: sanitiseUrl(entry.url) });
      return false;
    }
    return true;
  }

  private countHealthy(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.pool.values()) {
      if (!this.isQuarantined(entry, now)) count++;
    }
    return count;
  }

  private updateSession(taskId: string, patch: Partial<StickySession>): void {
    const existing = this.sessions.get(taskId);
    if (existing === undefined) return;
    this.sessions.set(taskId, { ...existing, ...patch });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function direct(): ProxyAllocation {
  return { proxyUrl: null, isProxied: false, label: 'direct' };
}

function toAllocation(url: string): ProxyAllocation {
  return { proxyUrl: url, isProxied: true, label: sanitiseUrl(url) };
}

/** Strip credentials from URL for safe logging */
function sanitiseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.password = '';
    parsed.username = '';
    return parsed.toString();
  } catch {
    return '[invalid-proxy-url]';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ProxyManager | null = null;

export function getProxyManager(): ProxyManager {
  if (instance === null) {
    instance = new ProxyManagerImpl();
  }
  return instance;
}

export function resetProxyManager(): void {
  instance = null;
}

export { ProxyManagerImpl, sanitiseUrl };
