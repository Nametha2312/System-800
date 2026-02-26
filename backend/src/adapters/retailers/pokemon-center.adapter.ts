import { BaseAdapter, RetailerAdapter, ShippingInfo, PaymentInfo, OrderResult } from '../base/adapter.interface.js';
import { getBrowserManager, BrowserManager } from '../base/browser-manager.js';
import { RetailerType, ProductInfo, StockStatus } from '../../types/index.js';
import { safeGoto, detectCaptchaOrBlock, safeType, clickFirst, CaptchaDetectedError } from '../../utils/captcha-detector.js';
import { fetchPage, extractJsonLd, parsePrice as parseHttpPrice, availabilityFromSchemaUrl } from '../base/http-fetcher.js';

const LOG_PREFIX = '[Monitor] Pokemon Center';
const CHECKOUT_LOG_PREFIX = '[Checkout] Pokemon Center';

const POKEMON_CENTER_URL_PATTERN = /^https?:\/\/(www\.)?pokemoncenter\.com\/.*/;
const POKEMON_CENTER_PRODUCT_ID_PATTERN = /\/[^\/]+\/(\d+)-\d+/;

const SELECTORS = {
  productTitle: [
    'h1.pdp-product-name',
    '.product-title h1',
    '.product-name',
    'h1[data-testid="product-title"]',
    'h1',
  ],
  price: [
    '.price',
    '.product-price .price',
    '[data-testid="product-price"]',
    '.price-current',
    'span.price',
  ],
  addToCart: [
    'button[data-testid="add-to-cart"]',
    '.add-to-cart-button',
    'button.btn-add-to-cart',
    'button[aria-label*="Add to Cart"]',
    'button[id*="add-to-cart"]',
  ],
  outOfStock: [
    '.out-of-stock',
    '[data-testid="sold-out"]',
    '.sold-out-message',
    '.unavailable',
    'button[aria-label*="Sold Out"]',
  ],
  inStock: [
    '.in-stock',
    '[data-testid="in-stock"]',
    '.available',
  ],
  // Cart / checkout navigation
  cartBtn: ['.cart-link', 'a[href*="/cart"]', '[aria-label*="cart"]'],
  checkoutBtn: [
    '.checkout-button',
    '[data-testid="checkout"]',
    'button[aria-label*="Check Out"]',
    'a[href*="/checkout"]',
  ],
  // Auth
  loginEmail: ['input[type="email"]', '#email', 'input[name="email"]'],
  loginPassword: ['input[type="password"]', '#password', 'input[name="password"]'],
  loginSubmit: ['button[type="submit"]', '.login-button', '[data-testid="sign-in"]'],
  // Shipping form
  shipping: {
    firstName: ['input[name="firstName"]', '#firstName', 'input[placeholder*="First Name"]'],
    lastName: ['input[name="lastName"]', '#lastName', 'input[placeholder*="Last Name"]'],
    address1: ['input[name="address1"]', '#address1', 'input[placeholder*="Address"]'],
    city: ['input[name="city"]', '#city'],
    state: ['select[name="state"]', '#state'],
    zip: ['input[name="zip"]', '#zip', 'input[placeholder*="ZIP"]'],
    phone: ['input[name="phone"]', '#phone'],
    continue: ['button[type="submit"]', '.continue-button', '[data-testid="continue"]'],
  },
  // Payment form
  payment: {
    cardNumber: ['input[name="cardNumber"]', '#cardNumber', 'input[placeholder*="Card Number"]'],
    expiry: ['input[name="expiry"]', '#expiry', 'input[placeholder*="MM/YY"]'],
    cvv: ['input[name="cvv"]', '#cvv'],
    nameOnCard: ['input[name="nameOnCard"]', '#nameOnCard'],
    placeOrder: ['button[type="submit"]', '.place-order-button', '[data-testid="place-order"]'],
  },
};

export class PokemonCenterAdapter extends BaseAdapter implements RetailerAdapter {
  private readonly browserManager: BrowserManager;

  constructor() {
    super(RetailerType.POKEMON_CENTER);
    this.browserManager = getBrowserManager();
  }

  getName(): string {
    return 'Pokemon Center';
  }

  validateUrl(url: string): boolean {
    return POKEMON_CENTER_URL_PATTERN.test(url);
  }

  extractProductId(url: string): string | null {
    const match = url.match(POKEMON_CENTER_PRODUCT_ID_PATTERN);
    return match?.[1] ?? null;
  }

  protected async fetchProductInfo(url: string): Promise<ProductInfo> {
    const { $, statusCode } = await fetchPage(
      url,
      25000,
      { Referer: 'https://www.google.com/search?q=pokemon+center' },
      { useProxy: true },
    );

    if (statusCode === 404) throw new Error(`Product not found (404): ${url}`);
    if (statusCode === 403 || statusCode === 429) throw new Error(`Blocked (${statusCode}): ${url}`);

    // Detect Imperva/Incapsula challenge page (fallback if proxy still gets challenged)
    const h1Text = $('h1').first().text().toLowerCase();
    if (h1Text.includes('pardon our interruption') || h1Text.includes('access denied')) {
      throw Object.assign(new Error('Pokemon Center bot-detection page — proxy may need upgrading.'), { name: 'BlockedError' });
    }

    const productId = this.extractProductId(url) ?? url;

    // ── 1. JSON-LD (schema.org Product) ─────────────────────────────────────
    for (const block of extractJsonLd($)) {
      if (block['@type'] === 'Product') {
        const name = block['name'] as string | undefined;
        const rawOffers = block['offers'] as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
        if (name !== undefined) {
          const price = offer ? parseHttpPrice(String((offer as Record<string, unknown>)['price'] ?? '')) : null;
          const avail = availabilityFromSchemaUrl((offer as Record<string, unknown> | undefined)?.['availability'] as string | undefined);
          return { productId, name: String(name), price, stockStatus: pokemonStockStatus(avail) };
        }
      }
    }

    // ── 2. CSS selectors ───────────────────────────────────────────────────
    const name =
      $('h1.pdp-product-name').first().text().trim() ||
      $('.product-title h1').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Unknown Pokemon Center Product';

    const priceText =
      $('[data-testid="product-price"]').first().text().trim() ||
      $('.price').first().text().trim() ||
      $('span.price').first().text().trim();
    const price = parseHttpPrice(priceText);

    const bodyText = $('body').text().toLowerCase();
    const hasCart = $('button[data-testid="add-to-cart"], .add-to-cart-button, button[id*="add-to-cart"]').length > 0;
    const isOos = $('.out-of-stock, [data-testid="sold-out"], .sold-out-message').length > 0
      || bodyText.includes('sold out')
      || bodyText.includes('out of stock');

    const stockStatus = isOos
      ? StockStatus.OUT_OF_STOCK
      : hasCart
      ? StockStatus.IN_STOCK
      : bodyText.includes('add to cart')
      ? StockStatus.IN_STOCK
      : StockStatus.UNKNOWN;

    if (name === 'Unknown Pokemon Center Product' && price === null) {
      throw new Error(`Could not parse product data from Pokemon Center page: ${url}`);
    }

    this.logger.info(`${LOG_PREFIX} fetched via HTTP`, { productId, name, price, stockStatus });
    return { productId, name, price, stockStatus };
  }

  /**
   * Fully automated checkout flow for Pokemon Center.
   * Order submission is DISABLED by default — uncomment Step 8 to enable live orders.
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
      this.logger.info(`${CHECKOUT_LOG_PREFIX} Starting checkout`, { productUrl });

      // Step 1: Navigate to product page
      await safeGoto(page, productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Step 2: Add to cart
      const addBtn = await clickFirst(page, SELECTORS.addToCart, 10000);
      if (addBtn === null) {
        return {
          success: false,
          error: { category: 'CHECKOUT_ERROR' as any, message: 'Add to cart button not found or item is sold out' },
        };
      }
      this.logger.info(`${CHECKOUT_LOG_PREFIX} Item added to cart`);
      await new Promise((r) => setTimeout(r, 2000));
      await detectCaptchaOrBlock(page);

      // Step 3: Navigate to cart
      try {
        await clickFirst(page, SELECTORS.cartBtn, 5000);
        await new Promise((r) => setTimeout(r, 1500));
      } catch {
        await safeGoto(page, 'https://www.pokemoncenter.com/cart', { waitUntil: 'domcontentloaded' });
      }

      // Step 4: Proceed to checkout
      const checkoutBtn = await clickFirst(page, SELECTORS.checkoutBtn, 10000);
      if (checkoutBtn === null) {
        return {
          success: false,
          error: { category: 'CHECKOUT_ERROR' as any, message: 'Checkout button not found' },
        };
      }
      await new Promise((r) => setTimeout(r, 2000));
      await detectCaptchaOrBlock(page);
      this.logger.info(`${CHECKOUT_LOG_PREFIX} Reached checkout`);

      // Step 5: Login
      try {
        const emailField = await page.$(SELECTORS.loginEmail[0]!);
        if (emailField !== null) {
          await safeType(page, SELECTORS.loginEmail[0]!, username);
          await safeType(page, SELECTORS.loginPassword[0]!, password);
          await clickFirst(page, SELECTORS.loginSubmit, 5000);
          await new Promise((r) => setTimeout(r, 3000));
          await detectCaptchaOrBlock(page);
          this.logger.info(`${CHECKOUT_LOG_PREFIX} Logged in`);
        }
      } catch {
        this.logger.debug(`${CHECKOUT_LOG_PREFIX} No login prompt, continuing as guest`);
      }

      // Step 6: Shipping info
      try {
        await page.waitForSelector(SELECTORS.shipping.firstName[0]!, { timeout: 10000 });
        await safeType(page, SELECTORS.shipping.firstName[0]!, shipping.firstName);
        await safeType(page, SELECTORS.shipping.lastName[0]!, shipping.lastName);
        await safeType(page, SELECTORS.shipping.address1[0]!, shipping.address1);
        await safeType(page, SELECTORS.shipping.city[0]!, shipping.city);
        try {
          await page.select(SELECTORS.shipping.state[0]!, shipping.state);
        } catch { /* state may already match */ }
        await safeType(page, SELECTORS.shipping.zip[0]!, shipping.zipCode);
        if (shipping.phone) {
          await safeType(page, SELECTORS.shipping.phone[0]!, shipping.phone);
        }
        await clickFirst(page, SELECTORS.shipping.continue, 10000);
        await new Promise((r) => setTimeout(r, 2000));
        this.logger.info(`${CHECKOUT_LOG_PREFIX} Shipping info filled`);
      } catch (err) {
        this.logger.warn(`${CHECKOUT_LOG_PREFIX} Shipping form issue`, { error: String(err) });
      }

      // Step 7: Payment info
      try {
        await page.waitForSelector(SELECTORS.payment.cardNumber[0]!, { timeout: 10000 });
        await safeType(page, SELECTORS.payment.cardNumber[0]!, payment.cardNumber.replace(/\s/g, ''));
        if (payment.expiryMonth && payment.expiryYear) {
          await safeType(
            page,
            SELECTORS.payment.expiry[0]!,
            `${payment.expiryMonth}/${payment.expiryYear.slice(-2)}`,
          );
        }
        await safeType(page, SELECTORS.payment.cvv[0]!, payment.cvv);
        if (payment.nameOnCard) {
          await safeType(page, SELECTORS.payment.nameOnCard[0]!, payment.nameOnCard);
        }
        this.logger.info(`${CHECKOUT_LOG_PREFIX} Payment info filled`);
      } catch (err) {
        this.logger.warn(`${CHECKOUT_LOG_PREFIX} Payment form issue`, { error: String(err) });
      }

      // Step 8: Place order (DISABLED BY DEFAULT — enable when ready for live orders)
      // await clickFirst(page, SELECTORS.payment.placeOrder, 10000);
      // await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
      // const orderId = await this.extractOrderConfirmation(page);
      // this.logger.info(`${CHECKOUT_LOG_PREFIX} Order placed - ${orderId}`);
      // return { success: true, orderNumber: orderId };

      this.logger.info(`${CHECKOUT_LOG_PREFIX} Checkout ready (order submission disabled)`);
      return { success: true, orderNumber: `PCO-READY-${Date.now()}` };

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (err instanceof CaptchaDetectedError) {
        this.logger.warn(`${CHECKOUT_LOG_PREFIX} CAPTCHA detected`, { message: error.message });
        return {
          success: false,
          error: { category: 'CAPTCHA' as any, message: `CAPTCHA DETECTED: ${error.message}` },
        };
      }
      this.logger.error(`${CHECKOUT_LOG_PREFIX} Checkout failed`, error, { productUrl });
      return {
        success: false,
        error: { category: 'CHECKOUT_ERROR' as any, message: error.message },
      };
    } finally {
      await this.browserManager.closePage(page);
    }
  }

  private async extractOrderConfirmation(page: any): Promise<string> {
    try {
      const text = await page.$eval(
        '.order-confirmation, [data-testid="order-number"], h1',
        (el: Element) => el.textContent?.trim() ?? '',
      );
      const match = text.match(/\d{6,}/);
      return match?.[0] ?? `PCO-${Date.now()}`;
    } catch {
      return `PCO-${Date.now()}`;
    }
  }

  protected parsePrice(priceText: string): number | null {
    const cleaned = priceText.replace(/[$,\s]/g, '').replace(/[^\d.]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
  }
}

// Singleton instance
let pokemonCenterAdapterInstance: PokemonCenterAdapter | null = null;

function pokemonStockStatus(avail: string): StockStatus {
  switch (avail) {
    case 'IN_STOCK': return StockStatus.IN_STOCK;
    case 'LOW_STOCK': return StockStatus.LOW_STOCK;
    case 'OUT_OF_STOCK': return StockStatus.OUT_OF_STOCK;
    case 'PREORDER': return StockStatus.PREORDER;
    case 'BACKORDER': return StockStatus.BACKORDER;
    default: return StockStatus.UNKNOWN;
  }
}

export function getPokemonCenterAdapter(): PokemonCenterAdapter {
  if (pokemonCenterAdapterInstance === null) {
    pokemonCenterAdapterInstance = new PokemonCenterAdapter();
  }
  return pokemonCenterAdapterInstance;
}