import { v4 as uuidv4 } from 'uuid';
import { vi } from 'vitest';
import {
  SKU,
  User,
  CheckoutAttempt,
  MonitoringEvent,
  Alert,
  ErrorLog,
  RetailerType,
  StockStatus,
  MonitoringStatus,
  CheckoutStatus,
  AlertType,
  ErrorCategory,
  ErrorSeverity,
  UserRole,
  ProductCheckResult,
} from '../types/index.js';

export function createMockSKU(overrides: Partial<SKU> = {}): SKU {
  return {
    id: uuidv4(),
    retailer: RetailerType.AMAZON,
    productId: 'B09BNFWW5V',
    productUrl: 'https://www.amazon.com/dp/B09BNFWW5V',
    productName: 'Test Product',
    targetPrice: 499.99,
    currentPrice: null,
    currentStockStatus: StockStatus.UNKNOWN,
    monitoringStatus: MonitoringStatus.ACTIVE,
    autoCheckoutEnabled: false,
    pollingIntervalMs: 60000,
    lastCheckedAt: null,
    lastStockChangeAt: null,
    consecutiveErrors: 0,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: uuidv4(),
    email: `test-${Date.now()}@example.com`,
    passwordHash: '$2b$10$hashedpassword',
    role: UserRole.USER,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockCheckoutAttempt(
  overrides: Partial<CheckoutAttempt> = {},
): CheckoutAttempt {
  return {
    id: uuidv4(),
    skuId: uuidv4(),
    credentialId: uuidv4(),
    status: CheckoutStatus.PENDING,
    startedAt: new Date(),
    completedAt: null,
    failureReason: null,
    errorCategory: null,
    currentStep: 'INITIATED',
    stepHistory: [],
    orderNumber: null,
    totalPrice: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockMonitoringEvent(
  overrides: Partial<MonitoringEvent> = {},
): MonitoringEvent {
  return {
    id: uuidv4(),
    skuId: uuidv4(),
    eventType: 'CHECK',
    previousStockStatus: null,
    newStockStatus: StockStatus.IN_STOCK,
    previousPrice: null,
    newPrice: 499.99,
    errorCategory: null,
    errorMessage: null,
    responseTimeMs: 1500,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: uuidv4(),
    type: AlertType.STOCK_AVAILABLE,
    skuId: uuidv4(),
    title: 'Product Available',
    message: 'Product is now in stock!',
    severity: ErrorSeverity.INFO,
    isRead: false,
    acknowledgedAt: null,
    acknowledgedBy: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockErrorLog(overrides: Partial<ErrorLog> = {}): ErrorLog {
  return {
    id: uuidv4(),
    category: ErrorCategory.DOM_CHANGED,
    severity: ErrorSeverity.ERROR,
    message: 'Failed to find price selector',
    stack: 'Error: Failed to find price selector\n    at Adapter.getPrice',
    context: { url: 'https://example.com', selector: '.price' },
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockProductCheckResult(
  overrides: Partial<ProductCheckResult> = {},
): ProductCheckResult {
  return {
    stockStatus: StockStatus.IN_STOCK,
    price: 499.99,
    title: 'Test Product',
    imageUrl: 'https://example.com/image.jpg',
    metadata: {},
    ...overrides,
  };
}

export function createMockJwtPayload(userId: string = uuidv4()) {
  return {
    userId,
    email: 'test@example.com',
    role: UserRole.USER,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

export function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: undefined,
    ip: '127.0.0.1',
    method: 'GET',
    path: '/',
    originalUrl: '/',
    ...overrides,
  };
}

export function createMockResponse() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  res.cookie = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(res);
  return res;
}

export function createMockNext() {
  return vi.fn();
}
