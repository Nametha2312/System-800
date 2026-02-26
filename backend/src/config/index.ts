import { z } from 'zod';
import dotenv from 'dotenv';

import type { AppConfig } from '../types/index.js';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).pipe(z.number().positive()).default('3000'),
  HOST: z.string().default('0.0.0.0'),
  API_VERSION: z.string().default('v1'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.string().transform(Number).pipe(z.number().positive()).default('2'),
  DATABASE_POOL_MAX: z.string().transform(Number).pipe(z.number().positive()).default('10'),
  DATABASE_IDLE_TIMEOUT: z.string().transform(Number).pipe(z.number().positive()).default('30000'),
  DATABASE_CONNECTION_TIMEOUT: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('10000'),

  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_MAX_RETRIES: z.string().transform(Number).pipe(z.number().nonnegative()).default('3'),
  REDIS_RETRY_DELAY: z.string().transform(Number).pipe(z.number().positive()).default('1000'),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('24h'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  ENCRYPTION_KEY: z.string().length(32),
  ENCRYPTION_IV_LENGTH: z.string().transform(Number).pipe(z.number().positive()).default('16'),

  RATE_LIMIT_WINDOW_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).pipe(z.number().positive()).default('100'),

  DEFAULT_POLLING_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('30000'),
  MIN_POLLING_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('10000'),
  MAX_POLLING_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('300000'),
  COOLDOWN_PERIOD_MS: z.string().transform(Number).pipe(z.number().positive()).default('60000'),

  CIRCUIT_BREAKER_THRESHOLD: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('5'),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('30000'),
  CIRCUIT_BREAKER_HALF_OPEN_MAX_REQUESTS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('3'),

  MAX_RETRY_ATTEMPTS: z.string().transform(Number).pipe(z.number().positive()).default('3'),
  RETRY_BASE_DELAY_MS: z.string().transform(Number).pipe(z.number().positive()).default('1000'),
  RETRY_MAX_DELAY_MS: z.string().transform(Number).pipe(z.number().positive()).default('30000'),

  QUEUE_CONCURRENCY: z.string().transform(Number).pipe(z.number().positive()).default('5'),
  QUEUE_MAX_JOBS_PER_WORKER: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('100'),
  DEAD_LETTER_MAX_AGE_DAYS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('7'),

  PUPPETEER_HEADLESS: z
    .string()
    .transform((val: string) => val === 'true')
    .default('true'),
  PUPPETEER_TIMEOUT_MS: z.string().transform(Number).pipe(z.number().positive()).default('30000'),
  PUPPETEER_NAVIGATION_TIMEOUT_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('60000'),
  /** Optional path to a real Chrome/Chromium binary; overrides Puppeteer's bundled Chromium */
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_PRETTY_PRINT: z
    .string()
    .transform((val: string) => val === 'true')
    .default('true'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  CORS_CREDENTIALS: z
    .string()
    .transform((val: string) => val === 'true')
    .default('true'),

  // ── Notifications ──────────────────────────────────────────────────────────
  NOTIFY_EMAIL_ENABLED: z
    .string()
    .transform((val: string) => val === 'true')
    .default('false'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z
    .string()
    .transform(Number)
    .pipe(z.number().nonnegative())
    .default('587'),
  SMTP_SECURE: z
    .string()
    .transform((val: string) => val === 'true')
    .default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  NOTIFY_EMAIL_FROM: z.string().default(''),
  NOTIFY_EMAIL_TO: z.string().default(''),

  NOTIFY_TELEGRAM_ENABLED: z
    .string()
    .transform((val: string) => val === 'true')
    .default('false'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),

  NOTIFY_DISCORD_ENABLED: z
    .string()
    .transform((val: string) => val === 'true')
    .default('false'),
  DISCORD_WEBHOOK_URL: z.string().default(''),

  // ── Proxy Management ───────────────────────────────────────────────────────
  PROXY_ENABLED: z
    .string()
    .transform((val: string) => val === 'true')
    .default('false'),
  /** Comma-separated list of proxy URLs, e.g. http://user:pass@1.2.3.4:8080 */
  PROXY_POOL: z.string().default(''),
  PROXY_ROTATION_MODE: z.enum(['soft', 'aggressive']).default('soft'),
  PROXY_MIN_ROTATION_INTERVAL_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('30000'),
  PROXY_QUARANTINE_DURATION_MS: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('600000'),
  PROXY_MAX_ROTATIONS_PER_TASK: z
    .string()
    .transform(Number)
    .pipe(z.number().positive())
    .default('5'),
});

type EnvConfig = z.infer<typeof envSchema>;

function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    const errors = Object.entries(formatted)
      .filter(([key]) => key !== '_errors')
      .map(([key, value]) => {
        const errorValue = value as { _errors?: string[] };
        return `  ${key}: ${errorValue._errors?.join(', ') ?? 'Unknown error'}`;
      })
      .join('\n');

    throw new Error(`Environment validation failed:\n${errors}`);
  }

  return result.data;
}

function createConfig(env: EnvConfig): AppConfig {
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    apiVersion: env.API_VERSION,
    database: {
      url: env.DATABASE_URL,
      poolMin: env.DATABASE_POOL_MIN,
      poolMax: env.DATABASE_POOL_MAX,
      idleTimeoutMs: env.DATABASE_IDLE_TIMEOUT,
      connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT,
    },
    redis: {
      url: env.REDIS_URL,
      maxRetries: env.REDIS_MAX_RETRIES,
      retryDelayMs: env.REDIS_RETRY_DELAY,
    },
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    encryption: {
      key: env.ENCRYPTION_KEY,
      ivLength: env.ENCRYPTION_IV_LENGTH,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    },
    monitoring: {
      defaultPollingIntervalMs: env.DEFAULT_POLLING_INTERVAL_MS,
      minPollingIntervalMs: env.MIN_POLLING_INTERVAL_MS,
      maxPollingIntervalMs: env.MAX_POLLING_INTERVAL_MS,
      cooldownPeriodMs: env.COOLDOWN_PERIOD_MS,
    },
    circuitBreaker: {
      threshold: env.CIRCUIT_BREAKER_THRESHOLD,
      resetTimeoutMs: env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      halfOpenMaxRequests: env.CIRCUIT_BREAKER_HALF_OPEN_MAX_REQUESTS,
    },
    retry: {
      maxAttempts: env.MAX_RETRY_ATTEMPTS,
      baseDelayMs: env.RETRY_BASE_DELAY_MS,
      maxDelayMs: env.RETRY_MAX_DELAY_MS,
    },
    queue: {
      concurrency: env.QUEUE_CONCURRENCY,
      maxJobsPerWorker: env.QUEUE_MAX_JOBS_PER_WORKER,
      deadLetterMaxAgeDays: env.DEAD_LETTER_MAX_AGE_DAYS,
    },
    puppeteer: {
      headless: env.PUPPETEER_HEADLESS,
      timeoutMs: env.PUPPETEER_TIMEOUT_MS,
      navigationTimeoutMs: env.PUPPETEER_NAVIGATION_TIMEOUT_MS,
      executablePath: env.PUPPETEER_EXECUTABLE_PATH,
    },
    logging: {
      level: env.LOG_LEVEL,
      prettyPrint: env.LOG_PRETTY_PRINT,
    },
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: env.CORS_CREDENTIALS,
    },
    notifications: {
      email: {
        enabled: env.NOTIFY_EMAIL_ENABLED,
        smtpHost: env.SMTP_HOST,
        smtpPort: env.SMTP_PORT,
        smtpSecure: env.SMTP_SECURE,
        smtpUser: env.SMTP_USER,
        smtpPass: env.SMTP_PASS,
        from: env.NOTIFY_EMAIL_FROM,
        to: env.NOTIFY_EMAIL_TO,
      },
      telegram: {
        enabled: env.NOTIFY_TELEGRAM_ENABLED,
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID,
      },
      discord: {
        enabled: env.NOTIFY_DISCORD_ENABLED,
        webhookUrl: env.DISCORD_WEBHOOK_URL,
      },
    },
    proxy: {
      enabled: env.PROXY_ENABLED,
      pool: env.PROXY_POOL
        .split(',')
        .map((u: string) => u.trim())
        .filter((u: string) => u.length > 0),
      rotationMode: env.PROXY_ROTATION_MODE,
      minRotationIntervalMs: env.PROXY_MIN_ROTATION_INTERVAL_MS,
      quarantineDurationMs: env.PROXY_QUARANTINE_DURATION_MS,
      maxRotationsPerTask: env.PROXY_MAX_ROTATIONS_PER_TASK,
    },
  };
}

const WEAK_SECRETS = [
  'your-super-secret-jwt-key-change-in-production-12345',
  'your-refresh-token-secret-change-in-production-67890',
  'change-this-in-production',
  'secret',
  'changeme',
];

const WEAK_ENCRYPTION_KEYS = [
  '12345678901234567890123456789012',
];

function validateProductionSecrets(env: EnvConfig): void {
  if (env.NODE_ENV !== 'production') return;

  const issues: string[] = [];

  if (WEAK_SECRETS.some((w) => env.JWT_SECRET.includes(w) || env.JWT_SECRET.length < 48)) {
    issues.push('JWT_SECRET is too weak or uses a demo value. Use a cryptographically random 64-char string.');
  }

  if (WEAK_SECRETS.some((w) => env.JWT_REFRESH_SECRET.includes(w) || env.JWT_REFRESH_SECRET.length < 48)) {
    issues.push('JWT_REFRESH_SECRET is too weak or uses a demo value.');
  }

  if (WEAK_ENCRYPTION_KEYS.includes(env.ENCRYPTION_KEY)) {
    issues.push('ENCRYPTION_KEY uses the default demo value. This will expose encrypted credentials.');
  }

  if (issues.length > 0) {
    throw new Error(
      `PRODUCTION SECURITY VIOLATION — unsafe secrets detected:\n${issues.map((i) => `  ✗ ${i}`).join('\n')}\n\nGenerate secrets with: openssl rand -hex 64`,
    );
  }
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig === null) {
    const env = validateEnv();
    validateProductionSecrets(env);
    cachedConfig = createConfig(env);
  }
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}

export function isProduction(): boolean {
  return getConfig().env === 'production';
}

export function isDevelopment(): boolean {
  return getConfig().env === 'development';
}

export function isTest(): boolean {
  return getConfig().env === 'test';
}
