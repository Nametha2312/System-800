import {
  RetailerType,
  ProductInfo,
  AdapterCheckResult,
  AdapterConfig,
  ErrorCategory,
  StockStatus,
} from '../../types/index.js';
import { getLogger, Logger } from '../../observability/logger.js';
import { getCircuitBreaker, CircuitBreaker, CircuitBreakerError } from '../../utils/circuit-breaker.js';
import { withRetry, RetryConfig } from '../../utils/retry.js';
import { getConfig } from '../../config/index.js';

export interface RetailerAdapter {
  readonly retailer: RetailerType;
  checkProduct(url: string): Promise<AdapterCheckResult>;
  validateUrl(url: string): boolean;
  extractProductId(url: string): string | null;
  getName(): string;
  isHealthy(): Promise<boolean>;
}

export interface CheckoutAdapter extends RetailerAdapter {
  addToCart(url: string): Promise<boolean>;
  proceedToCheckout(): Promise<boolean>;
  enterShippingInfo(info: ShippingInfo): Promise<boolean>;
  enterPaymentInfo(info: PaymentInfo): Promise<boolean>;
  submitOrder(): Promise<OrderResult>;
}

export interface ShippingInfo {
  readonly firstName: string;
  readonly lastName: string;
  readonly address1: string;
  readonly address2?: string;
  readonly city: string;
  readonly state: string;
  readonly zipCode: string;
  readonly country: string;
  readonly phone: string;
}

export interface PaymentInfo {
  readonly cardNumber: string;
  readonly expiryMonth: string;
  readonly expiryYear: string;
  readonly cvv: string;
  readonly nameOnCard: string;
  readonly billingAddress?: ShippingInfo;
}

export interface OrderResult {
  readonly success: boolean;
  readonly orderNumber?: string;
  readonly totalPrice?: number;
  readonly error?: {
    readonly category: ErrorCategory;
    readonly message: string;
  };
}

export abstract class BaseAdapter implements RetailerAdapter {
  readonly retailer: RetailerType;
  protected readonly logger: Logger;
  protected readonly circuitBreaker: CircuitBreaker;
  protected readonly config: AdapterConfig;
  protected readonly retryConfig: RetryConfig;

  constructor(retailer: RetailerType, config?: Partial<AdapterConfig>) {
    this.retailer = retailer;
    const appConfig = getConfig();

    this.config = {
      retailer: retailer,
      timeout: config?.timeout ?? appConfig.puppeteer.timeoutMs,
      retryAttempts: config?.retryAttempts ?? appConfig.retry.maxAttempts,
      userAgent:
        config?.userAgent ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      customHeaders: config?.customHeaders ?? {},
    };

    this.logger = getLogger().child({ adapter: this.getName() });

    this.circuitBreaker = getCircuitBreaker(`adapter-${retailer}`, appConfig.circuitBreaker);

    this.retryConfig = {
      maxAttempts: appConfig.retry.maxAttempts,
      baseDelayMs: appConfig.retry.baseDelayMs,
      maxDelayMs: appConfig.retry.maxDelayMs,
    };
  }

  abstract getName(): string;
  abstract validateUrl(url: string): boolean;
  abstract extractProductId(url: string): string | null;
  protected abstract fetchProductInfo(url: string): Promise<ProductInfo>;

  async checkProduct(url: string): Promise<AdapterCheckResult> {
    const startTime = Date.now();

    if (!this.validateUrl(url)) {
      return {
        success: false,
        error: {
          category: ErrorCategory.VALIDATION_ERROR,
          message: `Invalid URL for ${this.getName()}: ${url}`,
        },
        responseTimeMs: Date.now() - startTime,
        timestamp: new Date(),
      };
    }

    try {
      const productInfo = await this.circuitBreaker.execute(async () => {
        const result = await withRetry(
          async () => this.fetchProductInfo(url),
          this.retryConfig,
        );

        if (!result.success) {
          throw result.error ?? new Error('Failed to fetch product info');
        }

        return result.data as ProductInfo;
      });

      return {
        success: true,
        productInfo,
        responseTimeMs: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorCategory = this.categorizeError(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Product check failed', error instanceof Error ? error : undefined, {
        requestUrl: url,
        errorCategory,
      });

      return {
        success: false,
        error: {
          category: errorCategory,
          message: errorMessage,
        },
        responseTimeMs: Date.now() - startTime,
        timestamp: new Date(),
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    const status = this.circuitBreaker.getStatus();
    return status.state !== 'OPEN';
  }

  protected categorizeError(error: unknown): ErrorCategory {
    if (error instanceof CircuitBreakerError) {
      return ErrorCategory.RATE_LIMITED;
    }

    if (!(error instanceof Error)) {
      return ErrorCategory.UNKNOWN_ERROR;
    }

    const name = error.name;
    const message = error.message.toLowerCase();

    // CAPTCHA and bot-block errors — treat as RATE_LIMITED so circuit breaker backs off
    if (name === 'CaptchaDetectedError' || name === 'BlockedError') {
      return ErrorCategory.RATE_LIMITED;
    }

    if (message.includes('timeout') || message.includes('etimedout')) {
      return ErrorCategory.TIMEOUT_ERROR;
    }

    if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
      return ErrorCategory.NETWORK_ERROR;
    }

    if (message.includes('403') || message.includes('forbidden')) {
      return ErrorCategory.FORBIDDEN;
    }

    if (message.includes('429') || message.includes('rate limit') || message.includes('too many')) {
      return ErrorCategory.RATE_LIMITED;
    }

    if (message.includes('selector') || message.includes('element not found') || message.includes('dom')) {
      return ErrorCategory.DOM_CHANGED;
    }

    if (message.includes('partial') || message.includes('incomplete')) {
      return ErrorCategory.PARTIAL_LOAD;
    }

    if (message.includes('auth') || message.includes('login') || message.includes('session')) {
      return ErrorCategory.AUTH_EXPIRED;
    }

    return ErrorCategory.UNKNOWN_ERROR;
  }

  protected parsePrice(priceText: string): number | null {
    const cleaned = priceText.replace(/[^0-9.,]/g, '');
    const normalized = cleaned.replace(',', '.');
    const price = parseFloat(normalized);
    return isNaN(price) ? null : price;
  }

  protected parseStockStatus(stockText: string): StockStatus {
    const lower = stockText.toLowerCase();

    if (
      lower.includes('in stock') ||
      lower.includes('available') ||
      lower.includes('add to cart') ||
      lower.includes('buy now')
    ) {
      return StockStatus.IN_STOCK;
    }

    if (
      lower.includes('out of stock') ||
      lower.includes('unavailable') ||
      lower.includes('sold out') ||
      lower.includes('currently unavailable')
    ) {
      return StockStatus.OUT_OF_STOCK;
    }

    if (lower.includes('low stock') || lower.includes('only') || lower.includes('few left')) {
      return StockStatus.LOW_STOCK;
    }

    if (lower.includes('pre-order') || lower.includes('preorder') || lower.includes('pre order')) {
      return StockStatus.PREORDER;
    }

    if (lower.includes('backorder') || lower.includes('back order') || lower.includes('back-order')) {
      return StockStatus.BACKORDER;
    }

    return StockStatus.UNKNOWN;
  }
}
