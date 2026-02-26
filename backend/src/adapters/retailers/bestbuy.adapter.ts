import axios from 'axios';
import { BaseAdapter, RetailerAdapter } from '../base/adapter.interface.js';
import { fetchPage, extractJsonLd, parsePrice as parseHttpPrice, availabilityFromSchemaUrl } from '../base/http-fetcher.js';
import { RetailerType, ProductInfo, StockStatus } from '../../types/index.js';

const BESTBUY_URL_PATTERN = /^https?:\/\/(www\.)?bestbuy\.com\/.*/;
const BESTBUY_PRODUCT_ID_PATTERN = /\/(\d{5,7})\.p/;

// ---------------------------------------------------------------------------
// Best Buy Open API (https://developer.bestbuy.com — free, reliable)
// Set BESTBUY_API_KEY in .env to enable this path.
// ---------------------------------------------------------------------------
interface BestBuyApiProduct {
  sku: number;
  name: string;
  salePrice: number;
  regularPrice: number;
  onSale: boolean;
  onlineAvailability: boolean;
  inStoreAvailability: boolean;
}

async function fetchViaApi(sku: string): Promise<ProductInfo> {
  const apiKey = process.env['BESTBUY_API_KEY']!;
  const url = `https://api.bestbuy.com/v1/products/${sku}.json?apiKey=${apiKey}&show=sku,name,salePrice,regularPrice,onSale,onlineAvailability,inStoreAvailability&format=json`;
  const { data } = await axios.get<BestBuyApiProduct>(url, { timeout: 15000 });
  const price = data.salePrice ?? data.regularPrice ?? null;
  const stockStatus = data.onlineAvailability ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK;
  return { productId: String(data.sku), name: data.name, price, stockStatus };
}

export class BestBuyAdapter extends BaseAdapter implements RetailerAdapter {
  constructor() {
    super(RetailerType.BESTBUY);
  }

  getName(): string {
    return 'Best Buy';
  }

  validateUrl(url: string): boolean {
    return BESTBUY_URL_PATTERN.test(url);
  }

  extractProductId(url: string): string | null {
    const match = url.match(BESTBUY_PRODUCT_ID_PATTERN);
    if (match?.[1] !== undefined) return match[1];
    try {
      return new URL(url).searchParams.get('skuId');
    } catch {
      return null;
    }
  }

  protected async fetchProductInfo(url: string): Promise<ProductInfo> {
    const productId = this.extractProductId(url) ?? url;

    // ── 0. Best Buy Open API (preferred — bypasses Akamai bot detection) ────
    const apiKey = process.env['BESTBUY_API_KEY'];
    if (apiKey !== undefined && apiKey !== '' && /^\d+$/.test(productId)) {
      return fetchViaApi(productId);
    }

    // ── 1. HTTP scraping fallback ────────────────────────────────────────────
    const { $, statusCode } = await fetchPage(url, 30000); // longer timeout fallback

    if (statusCode === 404) throw new Error(`Product not found (404): ${url}`);
    if (statusCode === 403 || statusCode === 429) throw new Error(`Blocked (${statusCode}): ${url}`);

    // ── 1. JSON-LD (schema.org Product — most reliable) ─────────────────────
    for (const block of extractJsonLd($)) {
      if (block['@type'] === 'Product') {
        const name = block['name'] as string | undefined;
        const rawOffers = block['offers'] as Record<string, unknown> | Record<string, unknown>[] | undefined;
        const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
        if (offer !== undefined) {
          const price = parseHttpPrice(String(offer['price'] ?? ''));
          const stockStatus = toStockStatus(availabilityFromSchemaUrl(offer['availability'] as string | undefined));
          if (name !== undefined) {
            return { productId, name: String(name), price: price ?? extractBestBuyPrice($), stockStatus };
          }
        }
      }
    }

    // ── 2. Cheerio CSS selector fallback ────────────────────────────────────
    const name =
      $('[class*="sku-title"] h1').first().text().trim() ||
      $('h1[class*="heading"]').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Unknown Best Buy Product';

    const price = extractBestBuyPrice($);
    const stockStatus = extractBestBuyAvailability($);

    if (name === 'Unknown Best Buy Product' && price === null) {
      throw new Error(`Could not parse product data from Best Buy page: ${url}`);
    }

    return { productId, name, price, stockStatus };
  }
}

function extractBestBuyPrice($: ReturnType<typeof import('cheerio').load>): number | null {
  const priceSels = [
    '.priceView-hero-price span[aria-hidden="true"]',
    '.priceView-customer-price span[aria-hidden="true"]',
    '[data-testid="customer-price"] span[aria-hidden="true"]',
    '.priceView-hero-price span:first-child',
  ];
  for (const sel of priceSels) {
    const p = parseHttpPrice($(sel).first().text().trim());
    if (p !== null) return p;
  }
  return null;
}

function extractBestBuyAvailability($: ReturnType<typeof import('cheerio').load>): StockStatus {
  const btn = $('[data-button-state]').first();
  if (btn.length > 0) {
    const state = (btn.attr('data-button-state') ?? '').toUpperCase();
    if (state === 'ADD_TO_CART') return StockStatus.IN_STOCK;
    if (state === 'SOLD_OUT' || state === 'UNAVAILABLE') return StockStatus.OUT_OF_STOCK;
    if (state === 'PRE_ORDER' || state === 'PREORDER') return StockStatus.PREORDER;
  }
  const bodyText = $('body').text().toLowerCase();
  if (bodyText.includes('add to cart')) return StockStatus.IN_STOCK;
  if (bodyText.includes('sold out') || bodyText.includes('unavailable')) return StockStatus.OUT_OF_STOCK;
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

let bestBuyAdapterInstance: BestBuyAdapter | null = null;

export function getBestBuyAdapter(): BestBuyAdapter {
  if (bestBuyAdapterInstance === null) {
    bestBuyAdapterInstance = new BestBuyAdapter();
  }
  return bestBuyAdapterInstance;
}
