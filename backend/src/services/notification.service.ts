/**
 * External Notification Service
 *
 * Dispatches out-of-band notifications to configured channels (Email, Telegram,
 * Discord). All dispatch calls are FIRE-AND-FORGET — they never throw, never
 * block the caller, and never affect monitoring or checkout throughput.
 *
 * Channels are enabled/disabled independently via environment variables.
 * Each channel retries up to NOTIFY_MAX_RETRIES times with exponential back-off
 * before silently failing and logging the error.
 *
 * Trigger events wired into AlertService:
 *   STOCK_AVAILABLE   — product detected in stock
 *   PRICE_DROP        — target price met
 *   CHECKOUT_SUCCESS  — purchase completed
 *   CHECKOUT_FAILED   — purchase attempt failed
 *   MONITORING_ERROR  — SKU monitoring paused due to consecutive errors
 *   SYSTEM_ERROR      — general system fault
 */

import { AlertType } from '../types/index.js';
import { getLogger } from '../observability/logger.js';
import { getConfig } from '../config/index.js';

const logger = getLogger().child({ service: 'NotificationService' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationPayload {
  /** AlertType string value */
  readonly eventType: string;
  /** Retailer name e.g. WALMART */
  readonly site: string;
  /** Store product ID */
  readonly productId: string;
  /** Human-readable product name */
  readonly productName: string;
  /** Main notification body */
  readonly message: string;
  /** ISO-8601 timestamp */
  readonly timestamp: string;
  /** Optional extra data (price, order number, error, …) */
  readonly metadata?: Record<string, unknown>;
}

/** An event type that warrants pushing an external notification */
const NOTIFIABLE_EVENTS = new Set<string>([
  AlertType.STOCK_AVAILABLE,
  AlertType.PRICE_DROP,
  AlertType.CHECKOUT_SUCCESS,
  AlertType.CHECKOUT_FAILED,
  AlertType.MONITORING_ERROR,
  AlertType.SYSTEM_ERROR,
]);

// ---------------------------------------------------------------------------
// Retry helper (internal — does NOT use the global withRetry to stay
// self-contained and never surface errors to callers)
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryChannel(
  channelName: string,
  fn: () => Promise<void>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return; // success
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts) {
        logger.warn(`Notification channel "${channelName}" exhausted retries: ${msg}`);
        return;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.debug(`Notification channel "${channelName}" attempt ${attempt} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

// ---------------------------------------------------------------------------
// Email channel  (SMTP via nodemailer — optional dynamic import)
// If nodemailer is not installed the channel is silently disabled.
// ---------------------------------------------------------------------------

async function sendEmail(payload: NotificationPayload, cfg: ReturnType<typeof getConfig>): Promise<void> {
  const notifyCfg = cfg.notifications;
  if (!notifyCfg.email.enabled) return;
  if (!notifyCfg.email.smtpHost || !notifyCfg.email.to) return;

  // Dynamic import so the rest of the service works even without nodemailer
  let nodemailer: typeof import('nodemailer') | null = null;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    logger.warn('nodemailer not installed — email notifications disabled. Run: npm install nodemailer');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: notifyCfg.email.smtpHost,
    port: notifyCfg.email.smtpPort,
    secure: notifyCfg.email.smtpSecure,
    auth: notifyCfg.email.smtpUser
      ? { user: notifyCfg.email.smtpUser, pass: notifyCfg.email.smtpPass }
      : undefined,
  });

  const subject = `[System-800] ${payload.eventType} — ${payload.site} / ${payload.productName}`;
  const metaLines = payload.metadata
    ? Object.entries(payload.metadata)
      .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
      .join('\n')
    : '';

  const text = [
    `Event   : ${payload.eventType}`,
    `Site    : ${payload.site}`,
    `Product : ${payload.productName} (${payload.productId})`,
    `Time    : ${payload.timestamp}`,
    ``,
    payload.message,
    metaLines ? `\nDetails:\n${metaLines}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await transporter.sendMail({
    from: notifyCfg.email.from ?? 'System-800 <noreply@system800.local>',
    to: notifyCfg.email.to,
    subject,
    text,
  });

  logger.debug('Email notification sent', { event: payload.eventType, site: payload.site });
}

// ---------------------------------------------------------------------------
// Telegram channel  (Bot API — no extra deps, plain fetch)
// ---------------------------------------------------------------------------

async function sendTelegram(payload: NotificationPayload, cfg: ReturnType<typeof getConfig>): Promise<void> {
  const tgCfg = cfg.notifications.telegram;
  if (!tgCfg.enabled || !tgCfg.botToken || !tgCfg.chatId) return;

  const icon = eventIcon(payload.eventType);
  const meta = payload.metadata
    ? '\n' + Object.entries(payload.metadata)
      .map(([k, v]) => `  • ${k}: ${JSON.stringify(v)}`)
      .join('\n')
    : '';

  const text =
    `${icon} <b>[System-800] ${escapeHtml(payload.eventType)}</b>\n` +
    `🏪 <b>Site:</b> ${escapeHtml(payload.site)}\n` +
    `📦 <b>Product:</b> ${escapeHtml(payload.productName)} (<code>${escapeHtml(payload.productId)}</code>)\n` +
    `🕐 <b>Time:</b> ${escapeHtml(payload.timestamp)}\n\n` +
    escapeHtml(payload.message) +
    meta;

  const url = `https://api.telegram.org/bot${tgCfg.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tgCfg.chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }

  logger.debug('Telegram notification sent', { event: payload.eventType, site: payload.site });
}

// ---------------------------------------------------------------------------
// Discord channel  (webhook — no extra deps, plain fetch)
// ---------------------------------------------------------------------------

async function sendDiscord(payload: NotificationPayload, cfg: ReturnType<typeof getConfig>): Promise<void> {
  const discordCfg = cfg.notifications.discord;
  if (!discordCfg.enabled || !discordCfg.webhookUrl) return;

  const colour = eventColour(payload.eventType);
  const fieldsRaw: Array<{ name: string; value: string; inline: boolean }> = [
    { name: 'Site', value: payload.site, inline: true },
    { name: 'Product', value: `${payload.productName} (${payload.productId})`, inline: true },
    { name: 'Time', value: payload.timestamp, inline: false },
  ];

  if (payload.metadata) {
    for (const [k, v] of Object.entries(payload.metadata)) {
      fieldsRaw.push({ name: k, value: String(v), inline: true });
    }
  }

  const body = {
    embeds: [
      {
        title: `${eventIcon(payload.eventType)} ${payload.eventType}`,
        description: payload.message,
        color: colour,
        fields: fieldsRaw,
        footer: { text: 'System-800 Monitoring Bot' },
        timestamp: payload.timestamp,
      },
    ],
  };

  const res = await fetch(discordCfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok && res.status !== 204) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Discord webhook ${res.status}: ${bodyText}`);
  }

  logger.debug('Discord notification sent', { event: payload.eventType, site: payload.site });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function eventIcon(eventType: string): string {
  switch (eventType) {
    case AlertType.STOCK_AVAILABLE:   return '🟢';
    case AlertType.PRICE_DROP:        return '💰';
    case AlertType.CHECKOUT_SUCCESS:  return '✅';
    case AlertType.CHECKOUT_FAILED:   return '❌';
    case AlertType.MONITORING_ERROR:  return '⚠️';
    case AlertType.SYSTEM_ERROR:      return '🔴';
    default:                          return 'ℹ️';
  }
}

function eventColour(eventType: string): number {
  switch (eventType) {
    case AlertType.STOCK_AVAILABLE:   return 0x00c853; // green
    case AlertType.PRICE_DROP:        return 0x00b0ff; // blue
    case AlertType.CHECKOUT_SUCCESS:  return 0x00e676; // bright green
    case AlertType.CHECKOUT_FAILED:   return 0xff1744; // red
    case AlertType.MONITORING_ERROR:  return 0xff9100; // amber
    case AlertType.SYSTEM_ERROR:      return 0xd50000; // dark red
    default:                          return 0x616161; // grey
  }
}

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

export interface NotificationService {
  /**
   * Dispatch a notification for an alert event.
   * Non-blocking: schedules the work and returns immediately.
   * Never throws.
   */
  dispatch(payload: NotificationPayload): void;

  /** Returns true if the eventType should trigger an external notification */
  isNotifiable(eventType: string): boolean;
}

class NotificationServiceImpl implements NotificationService {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor() {
    this.maxRetries = 3;
    this.baseDelayMs = 1_000;
  }

  isNotifiable(eventType: string): boolean {
    return NOTIFIABLE_EVENTS.has(eventType);
  }

  /**
   * Fire-and-forget dispatch. Schedules all channels concurrently and
   * wraps everything in a catch so errors never propagate to callers.
   */
  dispatch(payload: NotificationPayload): void {
    if (!this.isNotifiable(payload.eventType)) return;

    // Run entirely in the background — do NOT await
    setImmediate(() => {
      void this.dispatchInternal(payload);
    });
  }

  private async dispatchInternal(payload: NotificationPayload): Promise<void> {
    let cfg: ReturnType<typeof getConfig>;
    try {
      cfg = getConfig();
    } catch {
      return; // config not ready (test environment etc.)
    }

    const channels: Array<[string, () => Promise<void>]> = [
      ['email',    () => sendEmail(payload, cfg)],
      ['telegram', () => sendTelegram(payload, cfg)],
      ['discord',  () => sendDiscord(payload, cfg)],
    ];

    await Promise.allSettled(
      channels.map(([name, fn]) =>
        retryChannel(name, fn, this.maxRetries, this.baseDelayMs),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (instance === null) {
    instance = new NotificationServiceImpl();
  }
  return instance;
}

export function resetNotificationService(): void {
  instance = null;
}

export { NOTIFIABLE_EVENTS, NotificationServiceImpl };
