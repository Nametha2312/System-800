import { RetailerAdapter, GenericAdapter, createGenericAdapter, GenericAdapterConfig } from './base/index.js';
import {
  getAmazonAdapter,
  getBestBuyAdapter,
  getWalmartAdapter,
  getTargetAdapter,
  getNeweggAdapter,
  getPokemonCenterAdapter,
} from './retailers/index.js';
import { RetailerType, CustomSelectors } from '../types/index.js';
import { getLogger } from '../observability/logger.js';

const logger = getLogger();

export class AdapterFactory {
  private readonly genericAdapters: Map<string, GenericAdapter> = new Map();

  getAdapter(retailer: RetailerType): RetailerAdapter {
    switch (retailer) {
      case RetailerType.AMAZON:
        return getAmazonAdapter();
      case RetailerType.BESTBUY:
        return getBestBuyAdapter();
      case RetailerType.WALMART:
        return getWalmartAdapter();
      case RetailerType.TARGET:
        return getTargetAdapter();
      case RetailerType.NEWEGG:
        return getNeweggAdapter();
      case RetailerType.POKEMON_CENTER:
        return getPokemonCenterAdapter();
      case RetailerType.GENERIC:
        throw new Error('Generic adapter requires custom configuration');
      default:
        throw new Error(`Unsupported retailer: ${retailer as string}`);
    }
  }

  getAdapterForUrl(url: string): RetailerAdapter | null {
    const adapters = [
      getAmazonAdapter(),
      getBestBuyAdapter(),
      getWalmartAdapter(),
      getTargetAdapter(),
      getNeweggAdapter(),
      getPokemonCenterAdapter(),
    ];

    for (const adapter of adapters) {
      if (adapter.validateUrl(url)) {
        return adapter;
      }
    }

    return null;
  }

  detectRetailer(url: string): RetailerType | null {
    const adapter = this.getAdapterForUrl(url);
    return adapter?.retailer ?? null;
  }

  createGenericAdapter(name: string, config: GenericAdapterConfig): GenericAdapter {
    const adapter = createGenericAdapter(config);
    this.genericAdapters.set(name, adapter);
    logger.info(`Generic adapter "${name}" created`);
    return adapter;
  }

  getGenericAdapter(name: string): GenericAdapter | null {
    return this.genericAdapters.get(name) ?? null;
  }

  removeGenericAdapter(name: string): boolean {
    const removed = this.genericAdapters.delete(name);
    if (removed) {
      logger.info(`Generic adapter "${name}" removed`);
    }
    return removed;
  }

  getAllAdapters(): RetailerAdapter[] {
    const standardAdapters: RetailerAdapter[] = [
      getAmazonAdapter(),
      getBestBuyAdapter(),
      getWalmartAdapter(),
      getTargetAdapter(),
      getNeweggAdapter(),
    ];

    return [...standardAdapters, ...Array.from(this.genericAdapters.values())];
  }

  async checkAllAdaptersHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const adapters = this.getAllAdapters();

    for (const adapter of adapters) {
      const isHealthy = await adapter.isHealthy();
      results.set(adapter.getName(), isHealthy);
    }

    return results;
  }

  getOrCreateAdapter(
    retailer: RetailerType,
    customSelectors?: CustomSelectors,
  ): RetailerAdapter {
    if (retailer === RetailerType.GENERIC && customSelectors !== undefined) {
      const configKey = JSON.stringify(customSelectors);
      let adapter = this.genericAdapters.get(configKey);

      if (adapter === undefined) {
        adapter = createGenericAdapter({
          selectors: customSelectors,
          retailerName: 'Custom',
        });
        this.genericAdapters.set(configKey, adapter);
      }

      return adapter;
    }

    return this.getAdapter(retailer);
  }
}

let adapterFactoryInstance: AdapterFactory | null = null;

export function getAdapterFactory(): AdapterFactory {
  if (adapterFactoryInstance === null) {
    adapterFactoryInstance = new AdapterFactory();
  }
  return adapterFactoryInstance;
}
