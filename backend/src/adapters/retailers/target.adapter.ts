import { BaseAdapter, RetailerAdapter, ShippingInfo, PaymentInfo, OrderResult } from '../base/adapter.interface.js';
import { getBrowserManager, BrowserManager } from '../base/browser-manager.js';
import { RetailerType, ProductInfo, StockStatus } from '../../types/index.js';
import { safeGoto, detectCaptchaOrBlock, safeType, clickFirst, CaptchaDetectedError } from '../../utils/captcha-detector.js';
import { getLogger } from '../../observability/logger.js';
import { fetchPage, extractJsonLd, parsePrice as parseHttpPrice, availabilityFromSchemaUrl } from '../base/http-fetcher.js';

const LOG_PREFIX = '[Monitor] Target';
const CHECKOUT_LOG_PREFIX = '[Checkout] Target';
const logger = getLogger().child({ adapter: 'Target' });

const TARGET_URL_PATTERN = /^https?:\/\/(www\.)?target\.com\/.*/;
const TARGET_PRODUCT_ID_PATTERN = /\/A-(\d+)/;

const SELECTORS = {
  productTitle: [
    '[data-test="product-title"]',
    'h1.Heading__StyledHeading-sc-1mp23s9-0',
    'h1[data-test="@web/ProductDetailPage/ProductTitle"]',
    'h1',
  ],
  price: [
    '[data-test="product-price"]',
    '.styles__CurrentPriceFontSize-sc-1mj8vhv-2',
    '[data-test="@web/Price/DealPrice"]',
    'span[data-test="@web/product-price"]',
  ],
  availability: [
    '[data-test="fulfillment-cell"]',
    '[data-test="shippingBlock"]',
    '.h-text-orangeDark',
  ],
  addToCart: [
    '[data-test="orderPickupButton"]',
    '[data-test="shippingATCButton"]',
    'button[data-test^="addToCart"]',
    'button[aria-label*="add to cart"]',
  ],
  outOfStock: [
    '[data-test="oosButton"]',
    '[data-test="soldOutButton"]',
  ],
  // Checkout flow
  checkoutBtn: [
    '[data-test="checkout-button"]',
    'a[href*="/checkout"]',
    'button[aria-label*="Check out"]',
  ],
  continueAsGuest: [
    '[data-test="continueAsGuestButton"]',
    'button[data-test*="guest"]',
  ],
  shipping: {
    firstName: ['input[id="firstName"]', 'input[name="firstName"]'],
    lastName: ['input[id="lastName"]', 'input[name="lastName"]'],
    address1: ['input[id="address1"]', 'input[name="address"]'],
    city: ['input[id="city"]', 'input[name="city"]'],
    state: ['input[id="state"]', 'select[name="state"]'],
    zip: ['input[id="zip"]', 'input[name="zip"]'],
    phone: ['input[id="phone"]', 'input[name="phone"]'],
    continue: ['[data-test="save"]', 'button[type="submit"]'],
  },
  payment: {
    cardNumber: ['input[id="creditCardNumber"]', 'input[name="cardNumber"]'],
    expiry: ['input[id="expirationDate"]', 'input[name="exp"]'],
    cvv: ['input[id="cvv"]', 'input[name="cvv"]'],
    placeOrder: ['[data-test="placeOrderButton"]', 'button[data-test*="place"]'],
  },
};

export class TargetAdapter extends BaseAdapter implements RetailerAdapter {
  private readonly browserManager: BrowserManager;

  constructor() {
    super(RetailerType.TARGET);
    this.browserManager = getBrowserManager();
  }

  getName(): string {
    return 'Target';
  }

  validateUrl(url: string): boolean {
    return TARGET_URL_PATTERN.test(url);
  }

  extractProductId(url: string): string | null {
    const match = url.match(TARGET_PRODUCT_ID_PATTERN);
    if (match !== null && match[1] !== undefined) {
      return match[1];
    }
    const urlObj = new URL(url);
    const preselect = urlObj.searchParams.get('preselect');
    if (preselect !== null) return preselect;
    return null;
  }

  protected async fetchProductInfo(url: string): Promise<ProductInfo> {
    // Target is a heavy React SPA — use proxy with JS rendering enabled
    const { $, statusCode } = await fetchPage(
      url,
      25000,
      { Referer: 'https://www.google.com/search?q=target+product' },
      { useProxy: true, renderJs: true },
    );

    if (statusCode === 404) throw new Error(`Product not found (404): ${url}`);
    if (statusCode === 403 || statusCode === 429) throw new Error(`Blocked (${statusCode}): ${url}`);

    // Detect bot-challenge page (fallback if proxy still gets challenged)
    const h1Text = $('h1').first().text().toLowerCase();
    if (h1Text.includes('access denied') || h1Text.includes('robot') || h1Text.includes('verify')) {
      throw Object.assign(new Error('Target bot-detection page — proxy may need upgrading.'), { name: 'BlockedError' });
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
          return { productId, name: String(name), price, stockStatus: targetStockStatus(avail) };
        }
      }
    }

    // ── 2. Target __NEXT_DATA__ embedded JSON ────────────────────────────────
    try {
      const nextDataHtml = $('script#__NEXT_DATA__').html();
      if (nextDataHtml) {
        const json = JSON.parse(nextDataHtml) as Record<string, unknown>;
        const pageProps = (json['props'] as Record<string, unknown>)?.['pageProps'] as Record<string, unknown> | undefined;
        const initialState = pageProps?.['__APOLLO_STATE__'] as Record<string, unknown> | undefined
          ?? pageProps?.['initialData'] as Record<string, unknown> | undefined;
        if (initialState !== undefined) {
          // Target stores product under ROOT_QUERY → product({"tcin":"..."}) key
          const productKey = Object.keys(initialState).find(k => k.startsWith('Product:'));
          if (productKey !== undefined) {
            const prod = initialState[productKey] as Record<string, unknown> | undefined;
            const itemName = (prod?.['item'] as Record<string, unknown>)?.['product_description'] as Record<string, unknown> | undefined;
            const title = (itemName?.['title'] as string | undefined) ?? prod?.['__typename'] as string | undefined;
            if (title !== undefined && typeof title === 'string') {
              const pricing = prod?.['price'] as Record<string, unknown> | undefined;
              const price = pricing ? parseHttpPrice(String(pricing['current_retail'] ?? pricing['formatted_current_price'] ?? '')) : null;
              return { productId, name: title, price, stockStatus: StockStatus.UNKNOWN };
            }
          }
        }
      }
    } catch { /* malformed __NEXT_DATA__ */ }

    // ── 3. CSS / meta tag fallback ───────────────────────────────────────────
    const name =
      $('[data-test="product-title"]').first().text().trim() ||
      $('h1[data-test="@web/ProductDetailPage/ProductTitle"]').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Unknown Target Product';

    const priceText =
      $('[data-test="product-price"]').first().text().trim() ||
      $('[data-test="@web/Price/DealPrice"]').first().text().trim() ||
      $('span[data-test="@web/product-price"]').first().text().trim();
    const price = parseHttpPrice(priceText);

    const hasCart = $('[data-test="orderPickupButton"], [data-test="shippingATCButton"], button[data-test^="addToCart"]').length > 0;
    const isOos = $('[data-test="oosButton"], [data-test="soldOutButton"]').length > 0;
    const bodyText = $('body').text().toLowerCase();
    const stockStatus = isOos
      ? StockStatus.OUT_OF_STOCK
      : hasCart
      ? StockStatus.IN_STOCK
      : bodyText.includes('out of stock') || bodyText.includes('sold out')
      ? StockStatus.OUT_OF_STOCK
      : StockStatus.UNKNOWN;

    if (name === 'Unknown Target Product' && price === null) {
      throw new Error(`Could not parse product data from Target page: ${url}`);
    }

    logger.info(`${LOG_PREFIX} fetched via HTTP`, { productId, name, price, stockStatus });
    return { productId, name, price, stockStatus };
  }

  /**
   * Execute full automated checkout on Target.
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

      // Step 1: Product page → detect stock
      await safeGoto(page, productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Step 2: Add to cart
      const addBtn = await clickFirst(page, SELECTORS.addToCart, 10000);
      if (addBtn === null) {
        return { success: false, error: { category: 'CHECKOUT_ERROR' as any, message: 'Add to cart button not found' } };
      }
      logger.info(`${CHECKOUT_LOG_PREFIX} Added to cart`);
      await new Promise((r) => setTimeout(r, 2000));
      await detectCaptchaOrBlock(page);

      // Step 3: Go to checkout
      const checkoutBtn = await clickFirst(page, SELECTORS.checkoutBtn, 10000);
      if (checkoutBtn === null) {
        await safeGoto(page, 'https://www.target.com/cart', { waitUntil: 'domcontentloaded' });
        await new Promise((r) => setTimeout(r, 1500));
        await clickFirst(page, SELECTORS.checkoutBtn, 10000);
      }
      await new Promise((r) => setTimeout(r, 2000));
      await detectCaptchaOrBlock(page);
      logger.info(`${CHECKOUT_LOG_PREFIX} Navigated to checkout`);

      // Step 4: Sign in or continue as guest
      try {
        const emailField = await page.$('input[type="email"], #username');
        if (emailField !== null) {
          await safeType(page, 'input[type="email"], #username', username);
          const pwField = await page.$('input[type="password"]');
          if (pwField !== null) {
            await safeType(page, 'input[type="password"]', password);
            await clickFirst(page, ['button[type="submit"]', '[data-test="loginButton"]'], 5000);
            await new Promise((r) => setTimeout(r, 3000));
            await detectCaptchaOrBlock(page);
            logger.info(`${CHECKOUT_LOG_PREFIX} Signed in`);
          }
        } else {
          // Try guest checkout
          await clickFirst(page, SELECTORS.continueAsGuest, 5000);
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch {
        logger.debug(`${CHECKOUT_LOG_PREFIX} No auth prompt`);
      }

      // Step 5: Shipping
      try {
        await page.waitForSelector(SELECTORS.shipping.firstName[0]!, { timeout: 10000 });
        await safeType(page, SELECTORS.shipping.firstName[0]!, shipping.firstName);
        await safeType(page, SELECTORS.shipping.lastName[0]!, shipping.lastName);
        await safeType(page, SELECTORS.shipping.address1[0]!, shipping.address1);
        await safeType(page, SELECTORS.shipping.city[0]!, shipping.city);
        await safeType(page, SELECTORS.shipping.zip[0]!, shipping.zipCode);
        if (shipping.phone) {
          await safeType(page, SELECTORS.shipping.phone[0]!, shipping.phone);
        }
        await clickFirst(page, SELECTORS.shipping.continue, 10000);
        await new Promise((r) => setTimeout(r, 2000));
        logger.info(`${CHECKOUT_LOG_PREFIX} Shipping filled`);
      } catch (err) {
        logger.warn(`${CHECKOUT_LOG_PREFIX} Shipping form issue`, { error: String(err) });
      }

      // Step 6: Payment
      try {
        await page.waitForSelector(SELECTORS.payment.cardNumber[0]!, { timeout: 10000 });
        await safeType(page, SELECTORS.payment.cardNumber[0]!, payment.cardNumber.replace(/\s/g, ''));
        if (payment.expiryMonth && payment.expiryYear) {
          await safeType(page, SELECTORS.payment.expiry[0]!, `${payment.expiryMonth}${payment.expiryYear.slice(-2)}`);
        }
        await safeType(page, SELECTORS.payment.cvv[0]!, payment.cvv);
        logger.info(`${CHECKOUT_LOG_PREFIX} Payment filled`);
      } catch (err) {
        logger.warn(`${CHECKOUT_LOG_PREFIX} Payment form issue`, { error: String(err) });
      }

      // Step 7: Place order (DISABLED BY DEFAULT for safety)
      // await clickFirst(page, SELECTORS.payment.placeOrder, 10000);
      // await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
      logger.info(`${CHECKOUT_LOG_PREFIX} Checkout complete (order submission disabled - enable in code)`);
      return { success: true, orderNumber: `TGT-READY-${Date.now()}` };

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (err instanceof CaptchaDetectedError) {
        logger.warn(`${CHECKOUT_LOG_PREFIX} CAPTCHA DETECTED`, { message: error.message });
        return { success: false, error: { category: 'CAPTCHA' as any, message: `CAPTCHA DETECTED: ${error.message}` } };
      }
      logger.error(`${CHECKOUT_LOG_PREFIX} Checkout failed`, error);
      return { success: false, error: { category: 'CHECKOUT_ERROR' as any, message: error.message } };
    } finally {
      await this.browserManager.closePage(page);
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
      if (lower.includes('out of stock') || lower.includes('sold out')) return StockStatus.OUT_OF_STOCK;
      if (lower.includes('limited stock') || lower.includes('only')) return StockStatus.LOW_STOCK;
      if (lower.includes('preorder')) return StockStatus.PREORDER;
      if (lower.includes('available') || lower.includes('ready')) return StockStatus.IN_STOCK;
    }
    if (hasAddToCart) return StockStatus.IN_STOCK;
    return StockStatus.UNKNOWN;
  }
}

let targetAdapterInstance: TargetAdapter | null = null;

function targetStockStatus(avail: string): StockStatus {
  switch (avail) {
    case 'IN_STOCK': return StockStatus.IN_STOCK;
    case 'LOW_STOCK': return StockStatus.LOW_STOCK;
    case 'OUT_OF_STOCK': return StockStatus.OUT_OF_STOCK;
    case 'PREORDER': return StockStatus.PREORDER;
    case 'BACKORDER': return StockStatus.BACKORDER;
    default: return StockStatus.UNKNOWN;
  }
}

export function getTargetAdapter(): TargetAdapter {
  if (targetAdapterInstance === null) {
    targetAdapterInstance = new TargetAdapter();
  }
  return targetAdapterInstance;
}
