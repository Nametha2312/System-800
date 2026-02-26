import { BaseAdapter, RetailerAdapter } from '../base/adapter.interface.js';
import { getBrowserManager, BrowserManager } from '../base/browser-manager.js';
import { RetailerType, ProductInfo, StockStatus } from '../../types/index.js';
import { fetchPage, extractJsonLd, parsePrice as parseHttpPrice, availabilityFromSchemaUrl } from '../base/http-fetcher.js';

const NEWEGG_URL_PATTERN = /^https?:\/\/(www\.)?newegg\.com\/.*/;
const NEWEGG_PRODUCT_ID_PATTERN = /\/p\/([A-Z0-9-]+)|Item=([A-Z0-9-]+)/;

const SELECTORS = {
  productTitle: [
    '.product-title',
    'h1.product-title',
    '[data-title]',
  ],
  price: [
    '.price-current',
    '.price-current strong',
    '.product-price .price-current',
  ],
  availability: [
    '.product-inventory',
    '.product-buy .atnPrimary',
    '#ProductBuy .btn-primary',
  ],
  outOfStock: [
    '.product-inventory.product-flag-out-of-stock',
    '.btn-message .btn-message-lg',
    '.product-buy-box .message',
  ],
  addToCart: [
    '.btn.btn-primary.btn-wide',
    '#ProductBuy .btn-primary',
    '.product-buy button.btn-primary',
  ],
};

export class NeweggAdapter extends BaseAdapter implements RetailerAdapter {
  private readonly browserManager: BrowserManager;

  constructor() {
    super(RetailerType.NEWEGG);
    this.browserManager = getBrowserManager();
  }

  getName(): string {
    return 'Newegg';
  }

  validateUrl(url: string): boolean {
    return NEWEGG_URL_PATTERN.test(url);
  }

  extractProductId(url: string): string | null {
    const match = url.match(NEWEGG_PRODUCT_ID_PATTERN);
    if (match !== null) {
      return match[1] ?? match[2] ?? null;
    }

    const urlObj = new URL(url);
    const item = urlObj.searchParams.get('Item');
    if (item !== null) {
      return item;
    }

    const pathParts = urlObj.pathname.split('/');
    const productIndex = pathParts.indexOf('p');
    if (productIndex !== -1 && pathParts[productIndex + 1] !== undefined) {
      return pathParts[productIndex + 1] ?? null;
    }

    return null;
  }

  protected async fetchProductInfo(url: string): Promise<ProductInfo> {
    // Newegg unblocks when requests appear to come from Google search
    const { $, statusCode } = await fetchPage(url, 25000, {
      Referer: 'https://www.google.com/search?q=newegg+product',
    });

    if (statusCode === 404) throw new Error(`Product not found (404): ${url}`);
    if (statusCode === 403 || statusCode === 429) throw new Error(`Blocked (${statusCode}): ${url}`);

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
          return { productId, name: String(name), price, stockStatus: neweggStockStatus(avail) };
        }
      }
    }

    // ── 2. CSS selectors (Newegg is server-rendered) ───────────────────────────
    const name =
      $('h1.product-title').first().text().trim() ||
      $('.product-title').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Unknown Newegg Product';

    // Newegg price: <li class="price-current"><strong>289</strong><sup>.99</sup>
    const priceEl = $('.price-current').first();
    let price: number | null = null;
    if (priceEl.length > 0) {
      const dollars = priceEl.find('strong').first().text().trim().replace(/,/g, '');
      const cents = priceEl.find('sup').first().text().trim().replace(/\./, '');
      price = parseHttpPrice(`${dollars}.${cents || '00'}`);
    }
    if (price === null) {
      price = parseHttpPrice($('.price-current').text().trim()) ??
              parseHttpPrice($('[class*="price"]').first().text().trim());
    }

    const isOos = $('.product-flag-out-of-stock, [class*="out-of-stock"]').length > 0;
    const hasCart = $('#ProductBuy .btn-primary, .btn.btn-primary.btn-wide').length > 0;
    const bodyText = $('body').text().toLowerCase();
    const stockStatus = isOos || bodyText.includes('out of stock')
      ? StockStatus.OUT_OF_STOCK
      : hasCart
      ? StockStatus.IN_STOCK
      : bodyText.includes('add to cart')
      ? StockStatus.IN_STOCK
      : StockStatus.UNKNOWN;

    if (name === 'Unknown Newegg Product' && price === null) {
      throw new Error(`Could not parse product data from Newegg page: ${url}`);
    }

    return { productId, name, price, stockStatus };
  }

  private determineStockStatus(
    hasAddToCart: boolean,
    isOutOfStock: boolean,
    availabilityText: string | null,
  ): StockStatus {
    if (isOutOfStock) {
      return StockStatus.OUT_OF_STOCK;
    }

    if (availabilityText !== null) {
      const lower = availabilityText.toLowerCase();

      if (lower.includes('out of stock') || lower.includes('sold out')) {
        return StockStatus.OUT_OF_STOCK;
      }

      if (lower.includes('in stock') || lower.includes('available')) {
        return StockStatus.IN_STOCK;
      }

      if (lower.includes('limited') || lower.includes('low stock')) {
        return StockStatus.LOW_STOCK;
      }

      if (lower.includes('pre-order') || lower.includes('preorder')) {
        return StockStatus.PREORDER;
      }

      if (lower.includes('back order') || lower.includes('backorder')) {
        return StockStatus.BACKORDER;
      }
    }

    if (hasAddToCart) {
      return StockStatus.IN_STOCK;
    }

    return StockStatus.UNKNOWN;
  }
}

let neweggAdapterInstance: NeweggAdapter | null = null;

function neweggStockStatus(avail: string): StockStatus {
  switch (avail) {
    case 'IN_STOCK': return StockStatus.IN_STOCK;
    case 'LOW_STOCK': return StockStatus.LOW_STOCK;
    case 'OUT_OF_STOCK': return StockStatus.OUT_OF_STOCK;
    case 'PREORDER': return StockStatus.PREORDER;
    case 'BACKORDER': return StockStatus.BACKORDER;
    default: return StockStatus.UNKNOWN;
  }
}

export function getNeweggAdapter(): NeweggAdapter {
  if (neweggAdapterInstance === null) {
    neweggAdapterInstance = new NeweggAdapter();
  }
  return neweggAdapterInstance;
}
