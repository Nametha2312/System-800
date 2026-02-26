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
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  SUCCESS = 'SUCCESS',
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

export enum AlertStatus {
  PENDING = 'PENDING',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SKU {
  id: string;
  retailer: RetailerType;
  productId: string;
  productUrl: string;
  productName: string;
  targetPrice: number | null;
  currentPrice: number | null;
  currentStockStatus: StockStatus;
  monitoringStatus: MonitoringStatus;
  autoCheckoutEnabled: boolean;
  pollingIntervalMs: number;
  lastCheckedAt: string | null;
  lastStockChangeAt: string | null;
  consecutiveErrors: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  skuId: string | null;
  type: AlertType;
  title: string;
  message: string;
  severity: string;
  isRead: boolean;
  metadata: Record<string, unknown>;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutAttempt {
  id: string;
  skuId: string;
  credentialId: string;
  status: CheckoutStatus;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  errorCategory: string | null;
  currentStep: string | null;
  stepHistory: unknown[];
  orderNumber: string | null;
  totalPrice: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetailerCredential {
  id: string;
  userId: string;
  retailer: RetailerType;
  username: string;
  paymentMethodId: string | null;
  shippingAddressId: string | null;
  isValid: boolean;
  lastValidatedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SKUStatistics {
  total: number;
  active: number;
  paused: number;
  stopped: number;
  inStock: number;
  outOfStock: number;
  withAutoCheckout: number;
}

export interface AlertCounts {
  total: number;
  pending: number;
  acknowledged: number;
  byType: Record<AlertType, number>;
}

export interface CheckoutStatistics {
  totalAttempts: number;
  successful: number;
  failed: number;
  pending: number;
  canceled: number;
  successRate: number;
  averageExecutionTimeMs: number;
  totalSpent: number;
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

export interface WorkerStatus {
  name: string;
  running: boolean;
  concurrency: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  checks: {
    name: string;
    healthy: boolean;
    message: string;
  }[];
}

export interface SystemInfo {
  health: HealthStatus;
  queues: QueueStats[];
  workers: WorkerStatus[];
  scheduler: {
    scheduledJobCount: number;
  };
  system: {
    nodeVersion: string;
    platform: string;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
  };
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface CreateSKUInput {
  retailer: RetailerType;
  productId: string;
  productUrl: string;
  productName: string;
  targetPrice?: number;
  autoCheckoutEnabled: boolean;
  pollingIntervalMs: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateSKUInput {
  retailer?: RetailerType;
  productId?: string;
  productUrl?: string;
  productName?: string;
  targetPrice?: number | null;
  autoCheckoutEnabled?: boolean;
  pollingIntervalMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateCredentialInput {
  retailer: RetailerType;
  username: string;
  password: string;
  paymentMethodId?: string;
  shippingAddressId?: string;
  metadata?: Record<string, unknown>;
}
