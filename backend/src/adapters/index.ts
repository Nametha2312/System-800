export {
  RetailerAdapter,
  CheckoutAdapter,
  BaseAdapter,
  ShippingInfo,
  PaymentInfo,
  OrderResult,
  BrowserManager,
  BrowserManagerConfig,
  PageOptions,
  getBrowserManager,
  closeBrowserManager,
  GenericAdapter,
  GenericAdapterConfig,
  createGenericAdapter,
} from './base/index.js';

export {
  AmazonAdapter,
  getAmazonAdapter,
  BestBuyAdapter,
  getBestBuyAdapter,
  WalmartAdapter,
  getWalmartAdapter,
  TargetAdapter,
  getTargetAdapter,
  NeweggAdapter,
  getNeweggAdapter,
} from './retailers/index.js';

export { AdapterFactory, getAdapterFactory } from './factory.js';
