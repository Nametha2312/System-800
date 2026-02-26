/**
 * Amazon adapter — HTTP-based (axios + cheerio).
 * Replaces the Puppeteer scraper to avoid browser fingerprinting.
 * Uses JSON-LD structured data + cheerio CSS selectors.
 */
import { BaseAdapter, RetailerAdapter } from '../base/adapter.interface.js';
import { fetchPage, extractJsonLd, parsePrice as parseHttpPrice, availabilityFromSchemaUrl } from '../base/http-fetcher.js';
import { RetailerType, ProductInfo, StockStatus } from '../../types/index.js';

const AMAZON_URL_PATTERN = /^https?:\/\/(www\.)?amazon\.(com|co\.uk|de|fr|es|it|ca|com\.au|in)\/.*$/;
const AMAZON_PRODUCT_ID_PATTERN = /\/dp\/([A-Z0-9]{10})|\/gp\/product\/([A-Z0-9]{10})/;

export class AmazonAdapter extends BaseAdapter implements RetailerAdapter {
  constructor() {
    super(RetailerType.AMAZON);
  }

  getName(): string {
    return 'Amazon';
  }

  validateUrl(url: string): boolean {
    return AMAZON_URL_PATTERN.test(url);
  }

  extractProductId(url: string): string | null {
    const match = url.match(AMAZON_PRODUCT_ID_PATTERN);
    if (match !== null) return match[1] ?? match[2] ?? null;
    try {
      const pathParts = new URL(url).pathname.split('/');
      const dpIndex = pathParts.indexOf('dp');
      if (dpIndex !== -1 && pathParts[dpIndex + 1]) return pathParts[dpIndex + 1]!;
    } catch { /* ignore */ }
    return null;
  }

  protected async fetchProductInfo(url: string): Promise<ProductInfo> {
    // Force USD locale so Amazon returns prices in US dollars, not local currency
    const { $, statusCode } = await fetchPage(url, 25000, {
      Cookie: 'i18n-prefs=USD; lc-main=en_US',
    });

    if (statusCode === 404 || statusCode === 410) throw new Error(`Product not found (${statusCode}): ${url}`);
    if (statusCode === 503 || statusCode === 429) throw new Error(`Amazon temporarily unavailable (${statusCode}): ${url}`);
    if (statusCode >= 400) throw new Error(`Amazon returned HTTP ${statusCode}: ${url}`);

    const productId = this.extractProductId(url) ?? url;

    // ── 1. JSON-LD (schema.org Product) ─────────────────────────────────
    for (const block of extractJsonLd($)) {
      if (block['@type'] === 'Product') {
        const name = block['name'] as string | undefined;
        const rawOffers = block['offers'] as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
        if (offer !== undefined && name !== undefined) {
          const price = parseHttpPrice(String(offer['price'] ?? ''));
          const stockStatus = toStockStatus(availabilityFromSchemaUrl(offer['availability'] as string | undefined));
          return { productId, name: String(name), price: price ?? extractAmazonPrice($), stockStatus };
        }
      }
    }

    // ── 2. Cheerio CSS selector fallback ────────────────────────────────
    const name =
      $('#productTitle').text().trim() ||
      $('#title').text().trim() ||
      $('h1').first().text().trim() ||
      'Unknown Amazon Product';

    // Check for CAPTCHA / robot wall
    const pageTitle = $('title').text().toLowerCase();
    if (pageTitle.includes('robot check') || pageTitle.includes('captcha') || pageTitle.includes('sorry')) {
      throw new Error(`Amazon bot-check detected (title: "${$('title').text()}").`);
    }

    if (name === 'Unknown Amazon Product' || name === '') {
      // Empty page — Amazon may have returned a redirect/unavailable page with 200
      throw new Error(`Product not found or unavailable on Amazon: ${url}`);
    }

    const price = extractAmazonPrice($);
    const stockStatus = extractAmazonAvailability($);

    return { productId, name, price, stockStatus };
  }
}

// Max plausible consumer-electronics price in USD.
// Discards third-party "Used from" or aggregated list prices that can be >$1 000.
const MAX_PLAUSIBLE_PRICE = 9_999;

function extractAmazonPrice($: ReturnType<typeof import('cheerio').load>): number | null {
  // Specific buybox / displayed-price selectors first, generic last.
  const selectors = [
    // Most specific – the price actually shown to the buyer
    '.apexPriceToPay .a-offscreen',
    '.priceToPay .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#priceblock_saleprice',
    '#price_inside_buybox',
    '#tp_price_block_total_price_ww .a-offscreen',
    // Broadest – may match "Used from" / third-party rows; apply sanity cap
    '.a-price .a-offscreen',
  ];

  for (const sel of selectors) {
    const els = $(sel);
    for (let i = 0; i < els.length; i++) {
      const p = parseHttpPrice(els.eq(i).text().trim());
      if (p !== null && p <= MAX_PLAUSIBLE_PRICE) return p;
    }
  }
  return null;
}

function extractAmazonAvailability($: ReturnType<typeof import('cheerio').load>): StockStatus {
  const availText = [
    '#availability',
    '#availabilityInsideBuyBox_feature_div',
    '.a-color-state',
  ].map(sel => $(sel).first().text().trim().toLowerCase()).filter(Boolean).join(' ');

  if (availText.includes('in stock')) return StockStatus.IN_STOCK;
  if (availText.includes('out of stock') || availText.includes('unavailable')) return StockStatus.OUT_OF_STOCK;
  if (availText.includes('only') && availText.includes('left')) return StockStatus.LOW_STOCK;
  if (availText.includes('pre-order') || availText.includes('preorder')) return StockStatus.PREORDER;
  if (availText.includes('temporarily out of stock')) return StockStatus.BACKORDER;

  if ($('#add-to-cart-button, #buy-now-button').length > 0) return StockStatus.IN_STOCK;

  return StockStatus.UNKNOWN;
}

function toStockStatus(avail: string): StockStatus {
  switch (avail) {
    case 'IN_STOCK': return StockStatus.IN_STOCK;
    case 'LOW_STOCK': return StockStatus.LOW_STOCK;
    case 'OUT_OF_STOCK': return StockStatus.OUT_OF_STOCK;
    case 'PREORDER': return StockStatus.PREORDER;
    case 'BACKORDER': return StockStatus.BACKORDER;
    default: return StockStatus.UNKNOWN;
  }
}

let amazonAdapterInstance: AmazonAdapter | null = null;

export function getAmazonAdapter(): AmazonAdapter {
  if (amazonAdapterInstance === null) {
    amazonAdapterInstance = new AmazonAdapter();
  }
  return amazonAdapterInstance;
}

