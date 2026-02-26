import { Page } from 'puppeteer';

import { BaseAdapter, RetailerAdapter } from './adapter.interface.js';
import { getBrowserManager, BrowserManager } from './browser-manager.js';
import { RetailerType, ProductInfo, StockStatus, CustomSelectors } from '../../types/index.js';

export interface GenericAdapterConfig {
  readonly selectors: CustomSelectors;
  readonly retailerName?: string;
  readonly urlPattern?: RegExp;
}

export class GenericAdapter extends BaseAdapter implements RetailerAdapter {
  private readonly browserManager: BrowserManager;
  private readonly selectors: CustomSelectors;
  private readonly retailerName: string;
  private readonly urlPattern: RegExp;

  constructor(config: GenericAdapterConfig) {
    super(RetailerType.GENERIC);
    this.browserManager = getBrowserManager();
    this.selectors = config.selectors;
    this.retailerName = config.retailerName ?? 'Generic';
    this.urlPattern = config.urlPattern ?? /^https?:\/\/.+/;
  }

  getName(): string {
    return this.retailerName;
  }

  validateUrl(url: string): boolean {
    try {
      new URL(url);
      return this.urlPattern.test(url);
    } catch {
      return false;
    }
  }

  extractProductId(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.replace(/\//g, '_').slice(1) || urlObj.hostname;
    } catch {
      return null;
    }
  }

  protected async fetchProductInfo(url: string): Promise<ProductInfo> {
    const page = await this.browserManager.createPage({
      blockResources: ['image', 'media', 'font'],
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      await page.waitForSelector(
        this.selectors.priceSelector ?? this.selectors.stockSelector ?? 'body',
        { timeout: 10000 },
      );

      const productInfo = await this.extractProductData(page, url);
      return productInfo;
    } finally {
      await this.browserManager.closePage(page);
    }
  }

  private async extractProductData(page: Page, url: string): Promise<ProductInfo> {
    const selectors = this.selectors;

    const data = await page.evaluate(
      (sel) => {
        const getText = (selector: string | undefined): string | null => {
          if (selector === undefined) return null;
          const element = document.querySelector(selector);
          return element?.textContent?.trim() ?? null;
        };

        return {
          name: getText(sel.productNameSelector) ?? document.title,
          price: getText(sel.priceSelector),
          stock: getText(sel.stockSelector),
        };
      },
      selectors,
    );

    const price = data.price !== null ? this.parsePrice(data.price) : null;
    const stockStatus = data.stock !== null ? this.parseStockStatus(data.stock) : StockStatus.UNKNOWN;

    return {
      productId: this.extractProductId(url) ?? url,
      name: data.name ?? 'Unknown Product',
      price,
      stockStatus,
    };
  }

  async checkWithCustomSelectors(
    url: string,
    selectors: CustomSelectors,
  ): Promise<ProductInfo> {
    const page = await this.browserManager.createPage({
      blockResources: ['image', 'media', 'font'],
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const data = await page.evaluate(
        (sel) => {
          const getText = (selector: string | undefined): string | null => {
            if (selector === undefined) return null;
            const element = document.querySelector(selector);
            return element?.textContent?.trim() ?? null;
          };

          return {
            name: getText(sel.productNameSelector) ?? document.title,
            price: getText(sel.priceSelector),
            stock: getText(sel.stockSelector),
          };
        },
        selectors,
      );

      const price = data.price !== null ? this.parsePrice(data.price) : null;
      const stockStatus = data.stock !== null ? this.parseStockStatus(data.stock) : StockStatus.UNKNOWN;

      return {
        productId: this.extractProductId(url) ?? url,
        name: data.name ?? 'Unknown Product',
        price,
        stockStatus,
      };
    } finally {
      await this.browserManager.closePage(page);
    }
  }
}

export function createGenericAdapter(config: GenericAdapterConfig): GenericAdapter {
  return new GenericAdapter(config);
}
