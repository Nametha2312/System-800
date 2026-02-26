/**
 * HTTP-based page fetcher using axios.
 * Mimics a real browser request without Puppeteer — avoids browser fingerprinting.
 * Both Best Buy and Amazon embed JSON-LD structured data in server-rendered HTML
 * which gives us price/availability without needing JavaScript execution.
 */
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { getLogger } from '../../observability/logger.js';

const logger = getLogger().child({ component: 'HttpFetcher' });

/** Rotate between several real Chrome UA strings */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

export interface FetchResult {
  html: string;
  $: cheerio.CheerioAPI;
  statusCode: number;
  finalUrl: string;
}

export interface FetchOptions {
  /**
   * Route this request through ScraperAPI to bypass bot protection
   * (Akamai, Imperva, Cloudflare, etc.).
   * Requires SCRAPER_API_KEY to be set in the environment.
   * Sign up free at https://www.scraperapi.com — 1 000 free credits/month.
   */
  useProxy?: boolean;
  /**
   * Ask ScraperAPI to execute JavaScript before returning HTML.
   * Required for heavy SPAs like Target. Slower and costs more credits.
   * Only used when useProxy=true.
   */
  renderJs?: boolean;
}

/**
 * Fetch a product page with browser-like headers.
 * Returns parsed cheerio instance ready for DOM queries.
 * @param extraHeaders Optional headers merged on top of the defaults (e.g. Cookie for locale).
 * @param options      Optional proxy/rendering options.
 */
export async function fetchPage(
  url: string,
  timeoutMs = 20000,
  extraHeaders: Record<string, string> = {},
  options: FetchOptions = {},
): Promise<FetchResult> {
  // ── ScraperAPI proxy path ─────────────────────────────────────────────────
  if (options.useProxy === true) {
    const scraperApiKey = process.env['SCRAPER_API_KEY'];
    if (!scraperApiKey) {
      throw new Error(
        'SCRAPER_API_KEY is not set. Add it to .env to enable proxy scraping for ' +
        'bot-protected retailers (Walmart, Target, Pokémon Center). ' +
        'Sign up free at https://www.scraperapi.com',
      );
    }

    const apiUrl = new URL('https://api.scraperapi.com/');
    apiUrl.searchParams.set('api_key', scraperApiKey);
    apiUrl.searchParams.set('url', url);
    if (options.renderJs === true) apiUrl.searchParams.set('render', 'true');
    // Keep geographic location in the US so prices/inventory are correct
    apiUrl.searchParams.set('country_code', 'us');

    logger.debug('Fetching page via ScraperAPI proxy', { url, renderJs: options.renderJs ?? false });

    const proxyConfig: AxiosRequestConfig = {
      timeout: timeoutMs + 90000, // ScraperAPI adds latency; JS render can take up to 90 s
      decompress: true,
      validateStatus: () => true,
    };

    const proxyResp: AxiosResponse<string> = await axios.get<string>(apiUrl.toString(), proxyConfig);
    const proxyHtml = typeof proxyResp.data === 'string' ? proxyResp.data : String(proxyResp.data);
    const proxy$ = cheerio.load(proxyHtml);

    logger.debug('ScraperAPI response received', {
      url,
      status: proxyResp.status,
      contentLength: proxyHtml.length,
      title: proxy$('title').text().slice(0, 80),
    });

    return { html: proxyHtml, $: proxy$, statusCode: proxyResp.status, finalUrl: url };
  }

  // ── Direct fetch path (no proxy) ─────────────────────────────────────────
  const ua = randomUA();

  const config: AxiosRequestConfig = {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1',
      ...extraHeaders,
    },
    timeout: timeoutMs,
    maxRedirects: 5,
    // axios automatically decompresses gzip/br
    decompress: true,
    // Return full response even on 4xx/5xx so we can inspect
    validateStatus: () => true,
  };

  logger.debug('Fetching page', { url, userAgent: ua.substring(0, 50) });

  const response: AxiosResponse<string> = await axios.get<string>(url, config);

  const html = typeof response.data === 'string' ? response.data : String(response.data);
  const $ = cheerio.load(html);

  logger.debug('Page fetched', {
    url,
    status: response.status,
    contentLength: html.length,
    title: $('title').text().slice(0, 80),
  });

  return {
    html,
    $,
    statusCode: response.status,
    finalUrl: url,
  };
}

/**
 * Extract all JSON-LD blocks from the page.
 * Both Amazon and Best Buy embed structured product data here.
 */
export function extractJsonLd(
  $: cheerio.CheerioAPI,
): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];

  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const text = $(el).html() ?? '';
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item !== null && typeof item === 'object') {
            blocks.push(item as Record<string, unknown>);
          }
        }
      } else if (parsed !== null && typeof parsed === 'object') {
        blocks.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Malformed JSON-LD — skip
    }
  });

  return blocks;
}

/**
 * Parse a price string like "$499.99" or "499.99" → 499.99
 */
export function parsePrice(text: string | null | undefined): number | null {
  if (text == null || text.trim() === '') return null;
  const cleaned = text.replace(/[^0-9.,]/g, '');
  // Handle European "499,99" format
  const normalized = cleaned.includes(',') && !cleaned.includes('.')
    ? cleaned.replace(',', '.')
    : cleaned.replace(/,/g, '');
  const price = parseFloat(normalized);
  return isNaN(price) || price <= 0 ? null : price;
}

/**
 * Map JSON-LD schema.org availability URL → StockStatus string
 */
export function availabilityFromSchemaUrl(url: string | undefined): string {
  if (url == null) return 'UNKNOWN';
  const lower = url.toLowerCase();
  if (lower.includes('instock')) return 'IN_STOCK';
  if (lower.includes('limitedavailability')) return 'LOW_STOCK';
  if (lower.includes('outofstock') || lower.includes('discontinued')) return 'OUT_OF_STOCK';
  if (lower.includes('preorder') || lower.includes('presale')) return 'PREORDER';
  if (lower.includes('backorder')) return 'BACKORDER';
  return 'UNKNOWN';
}
