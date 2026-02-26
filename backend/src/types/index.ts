/**
 * Core type definitions for the System-800 retail monitoring system.
 * All types are strictly typed with no 'any' allowed.
 */

// ============================================================================
// Enums
// ============================================================================

export enum StockStatus {
  IN_STOCK = 'IN_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  PREORDER = 'PREORDER',
  BACKORDER = 'BACKORDER',
  UNKNOWN = 'UNKNOWN',
}

export enum MonitoringStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
  COOLDOWN = 'COOLDOWN',
}

export enum CheckoutStatus {
  IDLE = 'IDLE',
  PENDING = 'PENDING',
  INITIATED = 'INITIATED',
  ADDING_TO_CART = 'ADDING_TO_CART',
  IN_CART = 'IN_CART',
  CHECKOUT_STARTED = 'CHECKOUT_STARTED',
  SHIPPING_ENTERED = 'SHIPPING_ENTERED',
  PAYMENT_ENTERED = 'PAYMENT_ENTERED',
  REVIEW = 'REVIEW',
  SUBMITTING = 'SUBMITTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMEOUT = 'TIMEOUT',
}

export enum RetailerType {
  AMAZON = 'AMAZON',
  BESTBUY = 'BESTBUY',
  WALMART = 'WALMART',
  TARGET = 'TARGET',
  NEWEGG = 'NEWEGG',
  POKEMON_CENTER = 'POKEMON_CENTER',
  GENERIC = 'GENERIC',
  CUSTOM = 'CUSTOM',
}

export enum AlertType {
  STOCK_AVAILABLE = 'STOCK_AVAILABLE',
  STOCK_UNAVAILABLE = 'STOCK_UNAVAILABLE',
  STOCK_LOW = 'STOCK_LOW',
  PRICE_DROP = 'PRICE_DROP',
  PRICE_INCREASE = 'PRICE_INCREASE',
  PRICE_CHANGE = 'PRICE_CHANGE',
  CHECKOUT_SUCCESS = 'CHECKOUT_SUCCESS',
  CHECKOUT_FAILED = 'CHECKOUT_FAILED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  MONITORING_ERROR = 'MONITORING_ERROR',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  ERROR = 'ERROR',
}

export enum ErrorCategory {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  FORBIDDEN = 'FORBIDDEN',
  DOM_CHANGED = 'DOM_CHANGED',
  PARTIAL_LOAD = 'PARTIAL_LOAD',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  QUEUE_OVERFLOW = 'QUEUE_OVERFLOW',
  REDIS_ERROR = 'REDIS_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  PAYMENT_REJECTED = 'PAYMENT_REJECTED',
  RACE_CONDITION = 'RACE_CONDITION',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export enum ErrorSeverity {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export enum JobStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DELAYED = 'DELAYED',
  PAUSED = 'PAUSED',
}

export enum UserRole {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
  USER = 'USER',
}

export enum AlertStatus {
  PENDING = 'PENDING',
  UNREAD = 'UNREAD',
  READ = 'READ',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  DISMISSED = 'DISMISSED',
}

// ============================================================================
// Base Interfaces
// ============================================================================

export interface Timestamps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SoftDelete {
  readonly deletedAt: Date | null;
}

export interface Identifiable {
  readonly id: string;
}

// ============================================================================
// Domain Entities
// ============================================================================

export interface User extends Identifiable, Timestamps {
  readonly email: string;
  readonly name?: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
}

export interface SKU extends Identifiable, Timestamps, SoftDelete {
  readonly retailer: RetailerType;
  readonly productId: string;
  readonly productUrl: string;
  readonly productName: string;
  readonly targetPrice: number | null;
  readonly currentPrice: number | null;
  readonly currentStockStatus: StockStatus;
  readonly monitoringStatus: MonitoringStatus;
  readonly autoCheckoutEnabled: boolean;
  readonly pollingIntervalMs: number;
  readonly lastCheckedAt: Date | null;
  readonly lastStockChangeAt: Date | null;
  readonly consecutiveErrors: number;
  readonly metadata: SKUMetadata;
}

export interface SKUMetadata {
  readonly userId?: string;
  readonly imageUrl?: string;
  readonly category?: string;
  readonly brand?: string;
  readonly customSelectors?: CustomSelectors;
  readonly notes?: string;
}

export interface CustomSelectors {
  readonly priceSelector?: string;
  readonly stockSelector?: string;
  readonly addToCartSelector?: string;
  readonly productNameSelector?: string;
}

export interface RetailerCredential extends Identifiable, Timestamps {
  readonly userId: string;
  readonly retailer: RetailerType;
  readonly username?: string;
  readonly encryptedUsername: string;
  readonly encryptedPassword: string;
  readonly encryptedPaymentInfo: string | null;
  readonly encryptedShippingInfo: string | null;
  readonly paymentMethodId?: string;
  readonly shippingAddressId?: string;
  readonly isValid: boolean;
  readonly lastValidatedAt: Date | null;
  readonly expiresAt: Date | null;
}

export interface CheckoutAttempt extends Identifiable, Timestamps {
  readonly userId?: string;
  readonly skuId: string;
  readonly credentialId: string;
  readonly status: CheckoutStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly failureReason: string | null;
  readonly errorMessage?: string | null;
  readonly errorCategory: ErrorCategory | null;
  readonly currentStep: string;
  readonly stepHistory: CheckoutStepRecord[];
  readonly orderNumber: string | null;
  readonly totalPrice: number | null;
}

export interface CheckoutStepRecord {
  readonly step: CheckoutStatus;
  readonly timestamp: Date;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

export interface MonitoringEvent extends Identifiable, Timestamps {
  readonly skuId: string;
  readonly eventType: 'CHECK' | 'STOCK_CHANGE' | 'PRICE_CHANGE' | 'ERROR';
  readonly previousStockStatus: StockStatus | null;
  readonly newStockStatus: StockStatus | null;
  readonly previousPrice: number | null;
  readonly newPrice: number | null;
  readonly errorCategory: ErrorCategory | null;
  readonly errorMessage: string | null;
  readonly responseTimeMs: number;
  readonly metadata: Record<string, unknown>;
}

export interface Alert extends Identifiable, Timestamps {
  readonly type: AlertType;
  readonly skuId: string | null;
  readonly title: string;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly isRead: boolean;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedBy: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface ErrorLog extends Identifiable, Timestamps {
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly message: string;
  readonly stack: string | null;
  readonly context: ErrorContext;
  readonly resolved: boolean;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
}

export interface ErrorContext {
  readonly skuId?: string;
  readonly retailer?: RetailerType;
  readonly jobId?: string;
  readonly attemptNumber?: number;
  readonly requestUrl?: string;
  readonly url?: string;
  readonly selector?: string;
  readonly httpStatus?: number;
  readonly responseBody?: string;
  readonly additionalInfo?: Record<string, unknown>;
}

export interface ProductCheckResult {
  readonly stockStatus: StockStatus;
  readonly price: number | null;
  readonly title: string | null;
  readonly imageUrl?: string;
  readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export interface CircuitBreakerConfig {
  readonly threshold: number;
  readonly resetTimeoutMs: number;
  readonly halfOpenMaxRequests: number;
}

export interface CircuitBreakerStatus {
  readonly state: CircuitBreakerState;
  readonly failureCount: number;
  readonly successCount: number;
  readonly lastFailureAt: Date | null;
  readonly nextRetryAt: Date | null;
}

// ============================================================================
// Queue Types
// ============================================================================

export interface MonitoringJobData {
  readonly skuId: string;
  readonly retailer: RetailerType;
  readonly productUrl: string;
  readonly attempt: number;
}

export interface CheckoutJobData {
  readonly skuId: string;
  readonly credentialId: string;
  readonly retailer: RetailerType;
  readonly productUrl: string;
  readonly attempt: number;
}

export interface JobResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly category: ErrorCategory;
    readonly message: string;
    readonly retryable: boolean;
  };
}

export interface QueueHealth {
  readonly name: string;
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
  readonly paused: boolean;
}

// ============================================================================
// Adapter Types
// ============================================================================

export interface ProductInfo {
  readonly productId: string;
  readonly name: string;
  readonly price: number | null;
  readonly stockStatus: StockStatus;
  readonly imageUrl?: string;
  readonly additionalInfo?: Record<string, unknown>;
}

export interface AdapterCheckResult {
  readonly success: boolean;
  readonly productInfo?: ProductInfo;
  readonly error?: {
    readonly category: ErrorCategory;
    readonly message: string;
  };
  readonly responseTimeMs: number;
  readonly timestamp: Date;
}

export interface AdapterConfig {
  readonly retailer: RetailerType;
  readonly userAgent?: string;
  readonly timeout?: number;
  readonly retryAttempts?: number;
  readonly customHeaders?: Record<string, string>;
}

// ============================================================================
// API Types
// ============================================================================

export interface PaginationParams {
  readonly page: number;
  readonly limit: number;
  readonly sortBy?: string;
  readonly sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  readonly data: T[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrev: boolean;
  };
}

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
  readonly timestamp: string;
}

// ============================================================================
// Health & Metrics
// ============================================================================

export interface SystemHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly timestamp: Date;
  readonly uptime: number;
  readonly components: ComponentHealth[];
  readonly checks?: ComponentHealth[];
}

export interface ComponentHealth {
  readonly name: string;
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly latencyMs?: number;
  readonly message?: string;
  readonly lastCheckedAt: Date;
}

export interface SystemMetrics {
  readonly timestamp: Date;
  readonly monitoring: {
    readonly activeSKUs: number;
    readonly pausedSKUs: number;
    readonly checksLast24h: number;
    readonly errorsLast24h: number;
    readonly averageResponseTimeMs: number;
  };
  readonly queue: {
    readonly totalJobs: number;
    readonly activeJobs: number;
    readonly failedJobs: number;
    readonly averageWaitTimeMs: number;
  };
  readonly checkout: {
    readonly attemptsLast24h: number;
    readonly successfulLast24h: number;
    readonly failedLast24h: number;
    readonly successRate: number;
  };
  readonly system: {
    readonly memoryUsageMB: number;
    readonly cpuUsagePercent: number;
    readonly activeConnections: number;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host: string;
  readonly apiVersion: string;
  readonly database: DatabaseConfig;
  readonly redis: RedisConfig;
  readonly jwt: JWTConfig;
  readonly encryption: EncryptionConfig;
  readonly rateLimit: RateLimitConfig;
  readonly monitoring: MonitoringConfig;
  readonly circuitBreaker: CircuitBreakerConfig;
  readonly retry: RetryConfig;
  readonly queue: QueueConfig;
  readonly puppeteer: PuppeteerConfig;
  readonly logging: LoggingConfig;
  readonly cors: CORSConfig;
  readonly notifications: NotificationConfig;
  readonly proxy: ProxyConfig;
}

export interface DatabaseConfig {
  readonly url: string;
  readonly poolMin: number;
  readonly poolMax: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
}

export interface RedisConfig {
  readonly url: string;
  readonly host?: string;
  readonly port?: number;
  readonly password?: string;
  readonly db?: number;
  readonly tls?: boolean;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
}

export interface JWTConfig {
  readonly secret: string;
  readonly expiresIn: string;
  readonly refreshSecret: string;
  readonly refreshExpiresIn: string;
}

export interface EncryptionConfig {
  readonly key: string;
  readonly ivLength: number;
}

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface MonitoringConfig {
  readonly defaultPollingIntervalMs: number;
  readonly minPollingIntervalMs: number;
  readonly maxPollingIntervalMs: number;
  readonly cooldownPeriodMs: number;
}

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface QueueConfig {
  readonly concurrency: number;
  readonly maxJobsPerWorker: number;
  readonly deadLetterMaxAgeDays: number;
}

export interface PuppeteerConfig {
  readonly headless: boolean;
  readonly timeoutMs: number;
  readonly navigationTimeoutMs: number;
}

export interface LoggingConfig {
  readonly level: string;
  readonly prettyPrint: boolean;
}

export interface CORSConfig {
  readonly origin: string;
  readonly credentials: boolean;
}

export interface EmailNotificationConfig {
  readonly enabled: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecure: boolean;
  readonly smtpUser: string;
  readonly smtpPass: string;
  readonly from: string;
  readonly to: string;
}

export interface TelegramNotificationConfig {
  readonly enabled: boolean;
  readonly botToken: string;
  readonly chatId: string;
}

export interface DiscordNotificationConfig {
  readonly enabled: boolean;
  readonly webhookUrl: string;
}

export interface NotificationConfig {
  readonly email: EmailNotificationConfig;
  readonly telegram: TelegramNotificationConfig;
  readonly discord: DiscordNotificationConfig;
}

export interface ProxyConfig {
  readonly enabled: boolean;
  /** Parsed array of proxy URLs from the PROXY_POOL env var */
  readonly pool: string[];
  readonly rotationMode: 'soft' | 'aggressive';
  readonly minRotationIntervalMs: number;
  readonly quarantineDurationMs: number;
  readonly maxRotationsPerTask: number;
}
