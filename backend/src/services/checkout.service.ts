import {
  SKU,
  CheckoutAttempt,
  CheckoutStatus,
  RetailerType,
  AlertType,
  RetailerCredential,
  PaginationParams,
  PaginatedResponse,
} from '../types/index.js';
import { getSKUService, SKUService } from './sku.service.js';
import { getAlertService, AlertService } from './alert.service.js';
import { getAdapterFactory, AdapterFactory } from '../adapters/factory.js';
import {
  ShippingInfo,
  PaymentInfo,
} from '../adapters/base/adapter.interface.js';
import {
  getCheckoutAttemptRepository,
  CheckoutAttemptRepository,
} from '../persistence/repositories/checkout-attempt.repository.js';
import {
  getCredentialRepository,
  CredentialRepository,
} from '../persistence/repositories/credential.repository.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getMetricsCollector, MetricNames } from '../observability/metrics.js';
import { getEncryptionService } from '../utils/encryption.js';

export interface CheckoutRequest {
  skuId: string;
  userId: string;
  maxPrice?: number;
  quantity?: number;
}

export interface CheckoutResult {
  attemptId: string;
  skuId: string;
  status: CheckoutStatus;
  orderNumber: string | null;
  totalPrice: number | null;
  errorMessage: string | null;
  executionTimeMs: number;
}

export interface CheckoutService {
  attemptCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  getAttemptById(id: string): Promise<CheckoutAttempt | null>;
  getAttemptsBySKU(skuId: string, pagination?: PaginationParams): Promise<PaginatedResponse<CheckoutAttempt>>;
  getAttemptsByUser(userId: string, pagination?: PaginationParams): Promise<PaginatedResponse<CheckoutAttempt>>;
  getRecentAttempts(limit?: number): Promise<CheckoutAttempt[]>;
  getSuccessRate(): Promise<number>;
  getCheckoutStatistics(): Promise<CheckoutStatistics>;
  cancelAttempt(attemptId: string): Promise<CheckoutAttempt>;
  clearAttemptsByUser(userId: string): Promise<number>;
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

class CheckoutServiceImpl implements CheckoutService {
  private readonly skuService: SKUService;
  private readonly alertService: AlertService;
  private readonly adapterFactory: AdapterFactory;
  private readonly attemptRepository: CheckoutAttemptRepository;
  private readonly credentialRepository: CredentialRepository;
  private readonly logger: Logger;
  private readonly maxRetries = 2;

  constructor(
    skuService?: SKUService,
    alertService?: AlertService,
    adapterFactory?: AdapterFactory,
    attemptRepository?: CheckoutAttemptRepository,
    credentialRepository?: CredentialRepository,
  ) {
    this.skuService = skuService ?? getSKUService();
    this.alertService = alertService ?? getAlertService();
    this.adapterFactory = adapterFactory ?? getAdapterFactory();
    this.attemptRepository = attemptRepository ?? getCheckoutAttemptRepository();
    this.credentialRepository = credentialRepository ?? getCredentialRepository();
    this.logger = getLogger().child({ service: 'CheckoutService' });
  }

  async attemptCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const startTime = Date.now();
    const metrics = getMetricsCollector();

    this.logger.info('Starting checkout attempt', {
      skuId: request.skuId,
      userId: request.userId,
    });

    metrics.incrementCounter(MetricNames.CHECKOUT_ATTEMPTS);

    const sku = await this.skuService.getById(request.skuId);
    if (sku === null) {
      throw new Error(`SKU not found: ${request.skuId}`);
    }

    if (!sku.autoCheckoutEnabled) {
      throw new Error(`Auto-checkout is not enabled for SKU: ${request.skuId}`);
    }

    if (request.maxPrice !== undefined && sku.currentPrice !== null) {
      if (sku.currentPrice > request.maxPrice) {
        throw new Error(
          `Current price $${sku.currentPrice} exceeds max price $${request.maxPrice}`,
        );
      }
    }

    const credential = await this.credentialRepository.findByUserAndRetailer(
      request.userId,
      sku.retailer,
    );

    if (credential === null) {
      throw new Error(`No credentials found for retailer ${sku.retailer}`);
    }

    const attempt = await this.attemptRepository.create({
      skuId: request.skuId,
      status: CheckoutStatus.INITIATED,
      credentialId: credential.id,
      failureReason: null,
      errorCategory: null,
      currentStep: 'initiated',
      stepHistory: [],
      orderNumber: null,
      totalPrice: null,
      startedAt: new Date(),
      completedAt: null,
    });

    const result: CheckoutResult = {
      attemptId: attempt.id,
      skuId: request.skuId,
      status: CheckoutStatus.INITIATED,
      orderNumber: null,
      totalPrice: null,
      errorMessage: null,
      executionTimeMs: 0,
    };

    try {
      await this.attemptRepository.update(attempt.id, {
        status: CheckoutStatus.SUBMITTING,
      });
      result.status = CheckoutStatus.SUBMITTING;

      const checkoutResult = await this.executeCheckout(
        sku,
        credential,
        request.quantity ?? 1,
      );

      if (checkoutResult.success) {
        result.status = CheckoutStatus.SUCCESS;
        result.orderNumber = checkoutResult.orderNumber ?? null;
        result.totalPrice = checkoutResult.totalPrice ?? null;

        metrics.incrementCounter(MetricNames.CHECKOUT_SUCCESSES);

        await this.alertService.createAlert({
          skuId: request.skuId,
          type: AlertType.CHECKOUT_SUCCESS,
          title: 'Checkout Successful',
          message: `Successfully purchased ${sku.productName} for $${checkoutResult.totalPrice ?? 0}`,
          metadata: {
            orderNumber: checkoutResult.orderNumber,
            totalPrice: checkoutResult.totalPrice,
            retailer: sku.retailer,
            productId: sku.productId,
          },
        });
      } else {
        result.status = CheckoutStatus.FAILED;
        result.errorMessage = checkoutResult.error ?? 'Checkout failed';

        metrics.incrementCounter(MetricNames.CHECKOUT_FAILURES);

        await this.alertService.createAlert({
          skuId: request.skuId,
          type: AlertType.CHECKOUT_FAILED,
          title: 'Checkout Failed',
          message: `Failed to purchase ${sku.productName}: ${result.errorMessage}`,
          metadata: {
            error: result.errorMessage,
            retailer: sku.retailer,
            productId: sku.productId,
            attemptId: attempt.id,
          },
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      result.status = CheckoutStatus.FAILED;
      result.errorMessage = err.message;

      metrics.incrementCounter(MetricNames.CHECKOUT_FAILURES);

      this.logger.error('Checkout failed with exception', err, {
        attemptId: attempt.id,
        skuId: request.skuId,
      });

      await this.alertService.createAlert({
        skuId: request.skuId,
        type: AlertType.CHECKOUT_FAILED,
        title: 'Checkout Error',
        message: `Checkout error for ${sku.productName}: ${err.message}`,
        metadata: {
          error: err.message,
          retailer: sku.retailer,
          productId: sku.productId,
          attemptId: attempt.id,
        },
      });
    }

    result.executionTimeMs = Date.now() - startTime;

    await this.attemptRepository.update(attempt.id, {
      status: result.status,
      orderNumber: result.orderNumber ?? null,
      totalPrice: result.totalPrice ?? null,
      failureReason: result.errorMessage ?? null,
      completedAt: new Date(),
    });

    this.logger.info('Checkout attempt completed', {
      attemptId: attempt.id,
      status: result.status,
      executionTimeMs: result.executionTimeMs,
    });

    return result;
  }

  private async executeCheckout(
    sku: SKU,
    credential: RetailerCredential,
    quantity: number,
  ): Promise<{ success: boolean; orderNumber?: string; totalPrice?: number; error?: string }> {
    const adapter = this.adapterFactory.getAdapter(sku.retailer);

    if (adapter === undefined) {
      return { success: false, error: `Adapter not available for ${sku.retailer}` };
    }

    // Decrypt stored credentials
    let username: string;
    let password: string;
    try {
      const enc = getEncryptionService();
      username = enc.decrypt(credential.encryptedUsername);
      password = enc.decrypt(credential.encryptedPassword);
    } catch (decryptErr) {
      const msg = decryptErr instanceof Error ? decryptErr.message : String(decryptErr);
      this.logger.error('Failed to decrypt credentials', new Error(msg), {
        retailer: sku.retailer,
        credentialId: credential.id,
      });
      return { success: false, error: `Credential decryption failed: ${msg}` };
    }

    // Extract shipping / payment from credential metadata
    const meta = credential.metadata as Record<string, unknown> | undefined;
    const shipping = meta?.shipping as ShippingInfo | undefined;
    const payment = meta?.payment as PaymentInfo | undefined;

    if (!shipping || !payment) {
      return {
        success: false,
        error:
          'Shipping or payment info missing from credential metadata. Please update your credentials.',
      };
    }

    // Call real adapter checkout if available
    if ('executeFullCheckout' in adapter && typeof (adapter as any).executeFullCheckout === 'function') {
      this.logger.info('Executing real adapter checkout', {
        retailer: sku.retailer,
        productId: sku.productId,
        quantity,
      });

      const result = await (adapter as any).executeFullCheckout(
        sku.productUrl,
        username,
        password,
        shipping,
        payment,
      );

      if (result.success) {
        return {
          success: true,
          orderNumber: result.orderNumber,
          totalPrice: result.totalPrice ?? sku.currentPrice ?? 0,
        };
      } else {
        return {
          success: false,
          error: result.error?.message ?? 'Checkout failed',
        };
      }
    }

    // Fallback: adapter has no checkout method
    this.logger.warn('Adapter has no executeFullCheckout, using simulated result', {
      retailer: sku.retailer,
    });
    return {
      success: false,
      error: `Retailer ${sku.retailer} checkout not yet implemented`,
    };
  }

  async getAttemptById(id: string): Promise<CheckoutAttempt | null> {
    return this.attemptRepository.findById(id);
  }

  async getAttemptsBySKU(
    skuId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<CheckoutAttempt>> {
    return this.attemptRepository.findWhere({ sku_id: skuId }, pagination);
  }

  async getAttemptsByUser(
    userId: string,
    pagination?: PaginationParams,
  ): Promise<PaginatedResponse<CheckoutAttempt>> {
    return this.attemptRepository.findByUserId(userId, pagination);
  }

  async clearAttemptsByUser(userId: string): Promise<number> {
    return this.attemptRepository.deleteByUserId(userId);
  }

  async getRecentAttempts(limit = 20): Promise<CheckoutAttempt[]> {
    const result = await this.attemptRepository.findAll({ page: 1, limit });
    return result.data;
  }

  async getSuccessRate(): Promise<number> {
    // Calculate success rate from findAll results
    const allAttempts = await this.attemptRepository.findAll({ page: 1, limit: 10000 });
    const successful = allAttempts.data.filter(a => a.status === CheckoutStatus.SUCCESS).length;
    return allAttempts.pagination.total > 0 ? (successful / allAttempts.pagination.total) * 100 : 0;
  }

  async getCheckoutStatistics(): Promise<CheckoutStatistics> {
    // Get all attempts and calculate statistics locally
    const allAttempts = await this.attemptRepository.findAll({ page: 1, limit: 10000 });
    const data = allAttempts.data;

    const totalAttempts = allAttempts.pagination.total;
    const successful = data.filter(a => a.status === CheckoutStatus.SUCCESS).length;
    const failed = data.filter(a => a.status === CheckoutStatus.FAILED).length;
    const pending = data.filter(a =>
      a.status === CheckoutStatus.INITIATED || a.status === CheckoutStatus.SUBMITTING
    ).length;
    const canceled = data.filter(a => a.status === CheckoutStatus.CANCELLED).length;

    const totalSpent = data
      .filter(a => a.status === CheckoutStatus.SUCCESS && a.totalPrice !== null)
      .reduce((sum, a) => sum + (a.totalPrice ?? 0), 0);

    // Calculate average execution time from completed attempts
    const completedAttempts = data.filter(a =>
      a.completedAt !== null && a.startedAt !== null
    );
    const avgTime = completedAttempts.length > 0
      ? completedAttempts.reduce((sum, a) => {
          const duration = new Date(a.completedAt!).getTime() - new Date(a.startedAt).getTime();
          return sum + duration;
        }, 0) / completedAttempts.length
      : 0;

    return {
      totalAttempts,
      successful,
      failed,
      pending,
      canceled,
      successRate: totalAttempts > 0 ? (successful / totalAttempts) * 100 : 0,
      averageExecutionTimeMs: avgTime,
      totalSpent,
    };
  }

  async cancelAttempt(attemptId: string): Promise<CheckoutAttempt> {
    this.logger.info('Cancelling checkout attempt', { attemptId });

    const attempt = await this.attemptRepository.findById(attemptId);
    if (attempt === null) {
      throw new Error(`Checkout attempt not found: ${attemptId}`);
    }

    if (
      attempt.status === CheckoutStatus.SUCCESS ||
      attempt.status === CheckoutStatus.CANCELLED
    ) {
      throw new Error(`Cannot cancel attempt with status: ${attempt.status}`);
    }

    const updated = await this.attemptRepository.update(attemptId, {
      status: CheckoutStatus.CANCELLED,
      completedAt: new Date(),
    });

    if (updated === null) {
      throw new Error(`Failed to cancel attempt: ${attemptId}`);
    }

    this.logger.info('Checkout attempt cancelled', { attemptId });
    return updated;
  }

  private async getNextAttemptNumber(skuId: string): Promise<number> {
    const result = await this.attemptRepository.findWhere({ sku_id: skuId }, { page: 1, limit: 1 });
    return result.pagination.total + 1;
  }
}

let checkoutServiceInstance: CheckoutService | null = null;

export function getCheckoutService(): CheckoutService {
  if (checkoutServiceInstance === null) {
    checkoutServiceInstance = new CheckoutServiceImpl();
  }
  return checkoutServiceInstance;
}

export { CheckoutServiceImpl };
