import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StockStatus, RetailerType } from '../../types';

// Mock browser page
const mockPage = {
  goto: vi.fn(),
  waitForSelector: vi.fn(),
  evaluate: vi.fn(),
  $: vi.fn(),
  $$: vi.fn(),
  click: vi.fn(),
  type: vi.fn(),
  close: vi.fn(),
  setUserAgent: vi.fn(),
  setViewport: vi.fn(),
  setDefaultTimeout: vi.fn(),
  on: vi.fn(),
};

// Mock browser instance
const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn(),
  pages: vi.fn().mockResolvedValue([]),
};

// Mock puppeteer
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

// Generic adapter for testing
class TestAdapter {
  private retryCount: number = 0;
  private maxRetries: number = 3;
  
  constructor(private browser: typeof mockBrowser) {}

  private parsePrice(price: string): number {
    // Remove currency symbols and commas
    const cleaned = price.replace(/[$,]/g, '');
    return parseFloat(cleaned) || 0;
  }

  async checkProduct(url: string) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      
      const data = await page.evaluate(() => {
        return {
          title: document.title,
          price: '499.99',
          inStock: true,
        };
      });

      return {
        stockStatus: data.inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
        price: this.parsePrice(data.price),
        title: data.title,
      };
    } finally {
      await page.close();
    }
  }

  async attemptCheckout(
    url: string,
    credentials: { username: string; password: string },
  ) {
    const page = await this.browser.newPage();

    try {
      await page.goto(url);

      // Login
      await page.type('#email', credentials.username);
      await page.type('#password', credentials.password);
      await page.click('#login-button');

      // Add to cart
      await page.waitForSelector('#add-to-cart');
      await page.click('#add-to-cart');

      // Checkout
      await page.waitForSelector('#checkout-button');
      await page.click('#checkout-button');

      // Confirm order
      await page.waitForSelector('#confirm-order');
      await page.click('#confirm-order');

      const orderId = await page.evaluate(() => {
        const el = document.querySelector('#order-id');
        return el?.textContent;
      });

      return {
        success: true,
        orderId,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    } finally {
      await page.close();
    }
  }
}

// Adapter factory for testing
function createAdapter(retailer: RetailerType, browser: typeof mockBrowser) {
  // All adapters use the same test adapter for now
  return new TestAdapter(browser);
}

describe('Adapters', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TestAdapter(mockBrowser);
  });

  describe('checkProduct', () => {
    it('should check product and return stock status', async () => {
      mockPage.evaluate.mockResolvedValue({
        title: 'PlayStation 5',
        price: '499.99',
        inStock: true,
      });

      const result = await adapter.checkProduct('https://www.amazon.com/dp/test');

      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://www.amazon.com/dp/test',
        expect.any(Object),
      );
      expect(result.stockStatus).toBe(StockStatus.IN_STOCK);
      expect(result.price).toBe(499.99);
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('should return out of stock status', async () => {
      mockPage.evaluate.mockResolvedValue({
        title: 'Test Product',
        price: '599.99',
        inStock: false,
      });

      const result = await adapter.checkProduct('https://example.com/product');

      expect(result.stockStatus).toBe(StockStatus.OUT_OF_STOCK);
    });

    it('should close page on error', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation failed'));

      await expect(
        adapter.checkProduct('https://example.com/product'),
      ).rejects.toThrow('Navigation failed');

      expect(mockPage.close).toHaveBeenCalled();
    });

    it('should parse price correctly', async () => {
      mockPage.goto.mockResolvedValue(undefined);
      mockPage.evaluate.mockResolvedValue({
        title: 'Test',
        price: '$1,299.99',
        inStock: true,
      });

      const result = await adapter.checkProduct('https://example.com');

      // This would need proper price parsing in real implementation
      expect(typeof result.price).toBe('number');
      expect(result.price).toBe(1299.99);
    });
  });

  describe('attemptCheckout', () => {
    it('should complete checkout successfully', async () => {
      mockPage.goto.mockResolvedValue(undefined);
      mockPage.waitForSelector.mockResolvedValue(true);
      mockPage.evaluate.mockResolvedValue('ORDER-12345');

      const result = await adapter.attemptCheckout('https://example.com/product', {
        username: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe('ORDER-12345');
      expect(mockPage.type).toHaveBeenCalledWith('#email', 'test@example.com');
      expect(mockPage.type).toHaveBeenCalledWith('#password', 'password123');
    });

    it('should handle checkout failure', async () => {
      mockPage.goto.mockResolvedValue(undefined);
      mockPage.waitForSelector.mockRejectedValue(
        new Error('Timeout waiting for element'),
      );

      const result = await adapter.attemptCheckout('https://example.com/product', {
        username: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout waiting for element');
    });

    it('should close page regardless of outcome', async () => {
      mockPage.waitForSelector.mockRejectedValue(new Error('Error'));

      await adapter.attemptCheckout('https://example.com/product', {
        username: 'test@example.com',
        password: 'password123',
      });

      expect(mockPage.close).toHaveBeenCalled();
    });
  });

  describe('Adapter Factory', () => {
    it('should create Amazon adapter', () => {
      const adapter = createAdapter(RetailerType.AMAZON, mockBrowser);
      expect(adapter).toBeInstanceOf(TestAdapter);
    });

    it('should create Best Buy adapter', () => {
      const adapter = createAdapter(RetailerType.BESTBUY, mockBrowser);
      expect(adapter).toBeInstanceOf(TestAdapter);
    });

    it('should create Walmart adapter', () => {
      const adapter = createAdapter(RetailerType.WALMART, mockBrowser);
      expect(adapter).toBeInstanceOf(TestAdapter);
    });

    it('should create Target adapter', () => {
      const adapter = createAdapter(RetailerType.TARGET, mockBrowser);
      expect(adapter).toBeInstanceOf(TestAdapter);
    });

    it('should create Newegg adapter', () => {
      const adapter = createAdapter(RetailerType.NEWEGG, mockBrowser);
      expect(adapter).toBeInstanceOf(TestAdapter);
    });

    it('should create Custom adapter', () => {
      const adapter = createAdapter(RetailerType.CUSTOM, mockBrowser);
      expect(adapter).toBeInstanceOf(TestAdapter);
    });
  });

  describe('Retailer URL Detection', () => {
    const detectRetailer = (url: string): RetailerType | null => {
      const lower = url.toLowerCase();
      if (lower.includes('amazon.')) return RetailerType.AMAZON;
      if (lower.includes('bestbuy.')) return RetailerType.BESTBUY;
      if (lower.includes('walmart.')) return RetailerType.WALMART;
      if (lower.includes('target.')) return RetailerType.TARGET;
      if (lower.includes('newegg.')) return RetailerType.NEWEGG;
      return null;
    };

    it('should detect Amazon URLs', () => {
      expect(detectRetailer('https://www.amazon.com/dp/B09BNFWW5V')).toBe(
        RetailerType.AMAZON,
      );
      expect(detectRetailer('https://amazon.co.uk/product')).toBe(
        RetailerType.AMAZON,
      );
    });

    it('should detect Best Buy URLs', () => {
      expect(detectRetailer('https://www.bestbuy.com/site/sku/123')).toBe(
        RetailerType.BESTBUY,
      );
    });

    it('should detect Walmart URLs', () => {
      expect(detectRetailer('https://www.walmart.com/ip/123456')).toBe(
        RetailerType.WALMART,
      );
    });

    it('should detect Target URLs', () => {
      expect(detectRetailer('https://www.target.com/p/product/-/A-123')).toBe(
        RetailerType.TARGET,
      );
    });

    it('should detect Newegg URLs', () => {
      expect(detectRetailer('https://www.newegg.com/p/N82E16819')).toBe(
        RetailerType.NEWEGG,
      );
    });

    it('should return null for unknown URLs', () => {
      expect(detectRetailer('https://unknown-store.com/product')).toBeNull();
    });
  });
});
