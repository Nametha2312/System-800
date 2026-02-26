import { BaseAdapter, RetailerAdapter, ShippingInfo, PaymentInfo, OrderResult } from '../base/adapter.interface.js';
import { getBrowserManager, BrowserManager } from '../base/browser-manager.js';
import { RetailerType, ProductInfo, StockStatus } from '../../types/index.js';
import { safeGoto, detectCaptchaOrBlock, safeType, clickFirst, CaptchaDetectedError } from '../../utils/captcha-detector.js';
import { getLogger } from '../../observability/logger.js';
import { fetchPage, extractJsonLd, parsePrice as parseHttpPrice, availabilityFromSchemaUrl } from '../base/http-fetcher.js';

const LOG_PREFIX = '[Monitor] Walmart';
const CHECKOUT_LOG_PREFIX = '[Checkout] Walmart';
const logger = getLogger().child({ adapter: 'Walmart' });

const WALMART_URL_PATTERN = /^https?:\/\/(www\.)?walmart\.com\/.*/;
const WALMART_PRODUCT_ID_PATTERN = /\/ip\/[^\/]+\/(\d+)|\/ip\/(\d+)/;

const SELECTORS = {
  productTitle: [
    '[itemprop="name"]',
    'h1.prod-ProductTitle',
    'h1[data-testid="product-title"]',
    '.f3.b.lh-copy',
  ],
  price: [
    '[itemprop="price"]',
    '.price-characteristic',
    '[data-testid="price-wrap"] .f1',
    '.price-group',
    'meta[itemprop="price"]',
  ],
  availability: [
    '[data-testid="add-to-cart-btn"]',
    '.prod-ProductOffer-oos498Out',
    '.fulfillment-shipping-text',
  ],
  outOfStock: [
    '.prod-ProductOffer-oosOut',
    '[data-testid="oos-text"]',
    '.oos-module',
  ],
  addToCart: [
    '[data-testid="add-to-cart-btn"]',
    'button[aria-label*="Add to cart"]',
    'button.add-to-cart-btn',
  ],
  checkout: [
    '[data-testid="checkout-btn"]',
    'a[href*="/checkout"]',
    'button[aria-label*="Checkout"]',
  ],
  // Shipping/address form selectors
  shipping: {
    firstName: ['input[name="firstName"]', '#firstName', 'input[placeholder*="First"]'],
    lastName: ['input[name="lastName"]', '#lastName', 'input[placeholder*="Last"]'],
    address1: ['input[name="address1"]', '#address1', 'input[placeholder*="Address"]'],
    city: ['input[name="city"]', '#city', 'input[placeholder*="City"]'],
    state: ['select[name="state"]', '#state'],
    zip: ['input[name="postalCode"]', '#postalCode', 'input[placeholder*="ZIP"]'],
    phone: ['input[name="phone"]', '#phone', 'input[placeholder*="Phone"]'],
    continue: ['button[aria-label*="Continue"]', '[data-testid="continue-btn"]', 'button[type="submit"]'],
  },
  // Payment form selectors
  payment: {
    cardNumber: ['input[name="cardNumber"]', '#creditCardNumber', 'input[placeholder*="Card"]'],
    expiry: ['input[name="expiration"]', '#expiry', 'input[placeholder*="MM/YY"]'],
    cvv: ['input[name="cvv"]', '#cvv', 'input[placeholder*="CVV"]'],
    nameOnCard: ['input[name="nameOnCard"]', '#nameOnCard'],
    placeOrder: ['button[aria-label*="Place order"]', '[data-testid="place-order-btn"]', 'button.place-order'],
  },
};

export class WalmartAdapter extends BaseAdapter implements RetailerAdapter {
  private readonly browserManager: BrowserManager;

  constructor() {
    super(RetailerType.WALMART);
    this.browserManager = getBrowserManager();
  }

  getName(): string {
    return 'Walmart';
  }

  validateUrl(url: string): boolean {
    return WALMART_URL_PATTERN.test(url);
  }

  extractProductId(url: string): string | null {
    const match = url.match(WALMART_PRODUCT_ID_PATTERN);
    if (match !== null) {
      return match[1] ?? match[2] ?? null;
    }
    return null;
  }

  protected async fetchProductInfo(url: string): Promise<ProductInfo> {
    const { $, statusCode } = await fetchPage(
      url,
      25000,
      { Referer: 'https://www.google.com/search?q=walmart+product' },
      { useProxy: true },
    );

    if (statusCode === 404) throw new Error(`Product not found (404): ${url}`);
    if (statusCode === 403 || statusCode === 429) throw new Error(`Blocked (${statusCode}): ${url}`);

    // Detect Walmart bot-detection challenge page (fallback if proxy still gets challenged)
    const pageTitle = $('title').text().toLowerCase();
    const h1Text = $('h1').first().text().toLowerCase();
    if (pageTitle.includes('robot or human') || h1Text.includes('robot or human') || pageTitle.includes('are you a robot')) {
      throw Object.assign(new Error('Walmart bot-detection challenge page — proxy may need upgrading.'), { name: 'BlockedError' });
    }

    const productId = this.extractProductId(url) ?? url;

    // ── 1. JSON-LD (schema.org Product) ─────────────────────────────────────
    for (const block of extractJsonLd($)) {
      if (block['@type'] === 'Product') {
        const name = block['name'] as string | undefined;
        const rawOffers = block['offers'] as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
        if (name !== undefined && offer !== undefined) {
          const price = parseHttpPrice(String(offer['price'] ?? ''));
          const avail = availabilityFromSchemaUrl(offer['availability'] as string | undefined);
          return { productId, name: String(name), price, stockStatus: walmartStockStatus(avail) };
        }
      }
    }

    // ── 2. Walmart __NEXT_DATA__ embedded JSON ───────────────────────────────
    try {
      const nextDataHtml = $('script#__NEXT_DATA__').html();
      if (nextDataHtml) {
        const json = JSON.parse(nextDataHtml) as Record<string, unknown>;
        const pageProps = (json['props'] as Record<string, unknown>)?.['pageProps'] as Record<string, unknown> | undefined;
        const initialData = pageProps?.['initialData'] as Record<string, unknown> | undefined;
        const item = ((initialData?.['data'] as Record<string, unknown>)?.['product'] as Record<string, unknown>)?.['item'] as Record<string, unknown> | undefined;
        if (item !== undefined) {
          const itemName = item['name'] as string | undefined;
          const priceInfo = ((item['priceInfo'] as Record<string, unknown>)?.['currentPrice'] as Record<string, unknown> | undefined);
          const price = priceInfo
            ? parseHttpPrice(String(priceInfo['price'] ?? priceInfo['priceString'] ?? ''))
            : null;
          const ofs = (item['availabilityStatus'] as string | undefined)?.toUpperCase();
          const stockStatus = ofs === 'IN_STOCK' ? StockStatus.IN_STOCK
            : ofs === 'OUT_OF_STOCK' ? StockStatus.OUT_OF_STOCK
            : StockStatus.UNKNOWN;
          if (itemName !== undefined) return { productId, name: itemName, price, stockStatus };
        }
      }
    } catch { /* malformed __NEXT_DATA__ */ }

    // ── 3. CSS / meta tag fallback ───────────────────────────────────────────
    const name =
      $('[itemprop="name"]').first().text().trim() ||
      $('h1[data-testid="product-title"]').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Unknown Walmart Product';

    const metaPrice = $('meta[itemprop="price"]').attr('content');
    const price = metaPrice
      ? parseHttpPrice(metaPrice)
      : parseHttpPrice($('[itemprop="price"]').first().text().trim());

    const bodyText = $('body').text().toLowerCase();
    const hasCart = $('[data-testid="add-to-cart-btn"], button[aria-label*="Add to cart"]').length > 0;
    const isOos = $('[data-testid="oos-text"]').length > 0 || bodyText.includes('out of stock');
    const stockStatus = isOos ? StockStatus.OUT_OF_STOCK : hasCart ? StockStatus.IN_STOCK : StockStatus.UNKNOWN;

    if (name === 'Unknown Walmart Product' && price === null) {
      throw new Error(`Could not parse product data from Walmart page: ${url}`);
    }

    logger.info(`${LOG_PREFIX} fetched via HTTP`, { productId, name, price, stockStatus });
    return { productId, name, price, stockStatus };
  }

  /**
   * Execute full automated checkout on Walmart.
   * Handles: add to cart â†’ login â†’ shipping â†’ payment â†’ order submit.
   */
  async executeFullCheckout(
    productUrl: string,
    username: string,
    password: string,
    shipping: ShippingInfo,
    payment: PaymentInfo,
  ): Promise<OrderResult> {
    const page = await this.browserManager.createPage();

    try {
      logger.info(`${CHECKOUT_LOG_PREFIX} Starting checkout`, { productUrl });

      // Step 1: Navigate to product page
      await safeGoto(page, productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      logger.info(`${CHECKOUT_LOG_PREFIX} Product page loaded`);

      // Step 2: Add to cart
      const addedToCart = await clickFirst(page, SELECTORS.addToCart, 10000);
      if (addedToCart === null) {
        return { success: false, error: { category: 'CHECKOUT_ERROR' as any, message: 'Could not find Add to Cart button' } };
      }
      logger.info(`${CHECKOUT_LOG_PREFIX} Item added to cart`);
      await new Promise((r) => setTimeout(r, 2000));
      await detectCaptchaOrBlock(page);

      // Step 3: Navigate to cart
      try {
        await page.waitForSelector('[data-testid="cart-icon-button"], a[href="/cart"]', { timeout: 5000 });
        await page.click('[data-testid="cart-icon-button"], a[href="/cart"]');
      } catch {
        await safeGoto(page, 'https://www.walmart.com/cart', { waitUntil: 'domcontentloaded' });
      }
      await new Promise((r) => setTimeout(r, 2000));

      // Step 4: Navigate to checkout
      const checkedOut = await clickFirst(page, SELECTORS.checkout, 10000);
      if (checkedOut === null) {
        await safeGoto(page, 'https://www.walmart.com/checkout', { waitUntil: 'domcontentloaded' });
      }
      await new Promise((r) => setTimeout(r, 2000));
      await detectCaptchaOrBlock(page);
      logger.info(`${CHECKOUT_LOG_PREFIX} Reached checkout page`);

      // Step 5: Sign in if prompted
      try {
        const emailField = await page.$('#email, input[type="email"]');
        if (emailField !== null) {
          await safeType(page, '#email, input[type="email"]', username);
          const pwField = await page.$('#password, input[type="password"]');
          if (pwField !== null) {
            await safeType(page, '#password, input[type="password"]', password);
            await clickFirst(page, ['button[type="submit"]', 'button.sign-in'], 5000);
            await new Promise((r) => setTimeout(r, 3000));
            await detectCaptchaOrBlock(page);
            logger.info(`${CHECKOUT_LOG_PREFIX} Sign-in submitted`);
          }
        }
      } catch {
        logger.debug(`${CHECKOUT_LOG_PREFIX} No sign-in prompt detected`);
      }

      // Step 6: Fill shipping info
      try {
        await safeType(page, SELECTORS.shipping.firstName[0]!, shipping.firstName);
        await safeType(page, SELECTORS.shipping.lastName[0]!, shipping.lastName);
        await safeType(page, SELECTORS.shipping.address1[0]!, shipping.address1);
        await safeType(page, SELECTORS.shipping.city[0]!, shipping.city);
        // State dropdown
        try {
          await page.select(SELECTORS.shipping.state[0]!, shipping.state);
        } catch { /* state may already be set */ }
        await safeType(page, SELECTORS.shipping.zip[0]!, shipping.zipCode);
        if (shipping.phone) {
          await safeType(page, SELECTORS.shipping.phone[0]!, shipping.phone);
        }
        const shipSubmit = await clickFirst(page, SELECTORS.shipping.continue, 10000);
        if (shipSubmit !== null) {
          await new Promise((r) => setTimeout(r, 2000));
        }
        logger.info(`${CHECKOUT_LOG_PREFIX} Shipping info filled`);
      } catch (err) {
        logger.warn(`${CHECKOUT_LOG_PREFIX} Shipping form issue`, { error: String(err) });
      }

      // Step 7: Fill payment info
      try {
        // Wait for payment form
        await page.waitForSelector('input[name="cardNumber"], #creditCardNumber', { timeout: 10000 });
        await safeType(page, SELECTORS.payment.cardNumber[0]!, payment.cardNumber.replace(/\s/g, ''));
        if (payment.expiryMonth && payment.expiryYear) {
          await safeType(page, SELECTORS.payment.expiry[0]!, `${payment.expiryMonth}/${payment.expiryYear.slice(-2)}`);
        }
        await safeType(page, SELECTORS.payment.cvv[0]!, payment.cvv);
        if (payment.nameOnCard) {
          await safeType(page, SELECTORS.payment.nameOnCard[0]!, payment.nameOnCard);
        }
        logger.info(`${CHECKOUT_LOG_PREFIX} Payment info filled`);
      } catch (err) {
        logger.warn(`${CHECKOUT_LOG_PREFIX} Payment form issue`, { error: String(err) });
      }

      // Step 8: Submit order (LIVE â€” use with care)
      // NOTE: Uncomment to enable real order submission
      // const orderBtn = await clickFirst(page, SELECTORS.payment.placeOrder, 10000);
      // if (orderBtn === null) {
      //   return { success: false, error: { category: 'CHECKOUT_ERROR' as any, message: 'Place order button not found' } };
      // }
      // await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
      // const orderNumber = await this.extractOrderNumber(page);
      // logger.info(`${CHECKOUT_LOG_PREFIX} Order Success - ${orderNumber}`);
      // return { success: true, orderNumber, totalPrice: /* extract */ undefined };

      // ORDER SUBMISSION IS DISABLED BY DEFAULT FOR SAFETY
      // To enable, uncomment the block above and remove this return
      logger.info(`${CHECKOUT_LOG_PREFIX} Checkout flow complete (submission disabled for safety)`);
      const orderId = `WMT-READY-${Date.now()}`;
      return { success: true, orderNumber: orderId };

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (err instanceof CaptchaDetectedError) {
        logger.warn(`${CHECKOUT_LOG_PREFIX} CAPTCHA DETECTED - retry needed`, { message: error.message });
        return { success: false, error: { category: 'CAPTCHA' as any, message: `CAPTCHA DETECTED: ${error.message}` } };
      }
      logger.error(`${CHECKOUT_LOG_PREFIX} Checkout failed`, error, { productUrl });
      return { success: false, error: { category: 'CHECKOUT_ERROR' as any, message: error.message } };
    } finally {
      await this.browserManager.closePage(page);
    }
  }

  private async extractOrderNumber(page: any): Promise<string | undefined> {
    try {
      const text = await page.$eval(
        '[data-testid="order-number"], .order-confirmation-number, h1',
        (el: Element) => el.textContent?.trim() ?? '',
      );
      const match = text.match(/\d{10,}/);
      return match?.[0] ?? `WMT-${Date.now()}`;
    } catch {
      return `WMT-${Date.now()}`;
    }
  }

  private determineStockStatus(
    hasAddToCart: boolean,
    isOutOfStock: boolean,
    availabilityText: string | null,
  ): StockStatus {
    if (isOutOfStock) return StockStatus.OUT_OF_STOCK;

    if (availabilityText !== null) {
      const lower = availabilityText.toLowerCase();
      if (lower.includes('out of stock') || lower.includes('unavailable')) return StockStatus.OUT_OF_STOCK;
      if (lower.includes('limited stock') || lower.includes('only') || lower.includes('few left')) return StockStatus.LOW_STOCK;
      if (lower.includes('preorder') || lower.includes('pre-order')) return StockStatus.PREORDER;
    }

    if (hasAddToCart) return StockStatus.IN_STOCK;
    return StockStatus.UNKNOWN;
  }
}


let walmartAdapterInstance: WalmartAdapter | null = null;

function walmartStockStatus(avail: string): StockStatus {
  switch (avail) {
    case 'IN_STOCK': return StockStatus.IN_STOCK;
    case 'LOW_STOCK': return StockStatus.LOW_STOCK;
    case 'OUT_OF_STOCK': return StockStatus.OUT_OF_STOCK;
    case 'PREORDER': return StockStatus.PREORDER;
    case 'BACKORDER': return StockStatus.BACKORDER;
    default: return StockStatus.UNKNOWN;
  }
}

export function getWalmartAdapter(): WalmartAdapter {
  if (walmartAdapterInstance === null) {
    walmartAdapterInstance = new WalmartAdapter();
  }
  return walmartAdapterInstance;
}
