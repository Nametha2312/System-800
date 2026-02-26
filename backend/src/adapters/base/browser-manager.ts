import puppeteer, { Browser, Page, PuppeteerLaunchOptions } from 'puppeteer';

import { getConfig } from '../../config/index.js';
import { getLogger } from '../../observability/logger.js';
import { getProxyContext } from '../../utils/proxy-context.js';

const logger = getLogger();

export interface BrowserManagerConfig {
  readonly headless: boolean;
  readonly timeout: number;
  readonly navigationTimeout: number;
  readonly userAgent?: string | undefined;
  /** Optional path to a real Chrome binary. Overrides Puppeteer's bundled Chromium. */
  readonly executablePath?: string | undefined;
}

export interface PageOptions {
  readonly userAgent?: string;
  readonly viewport?: { width: number; height: number };
  readonly extraHeaders?: Record<string, string>;
  readonly blockResources?: string[];
  /**
   * Explicit proxy URL override for this page.  When omitted the manager
   * checks the current AsyncLocalStorage proxy context automatically.
   * Set to the empty string '' to force direct (no proxy) for this page.
   */
  readonly proxyUrl?: string;
}

class BrowserManager {
  private browser: Browser | null = null;
  private readonly config: BrowserManagerConfig;
  private isClosing: boolean = false;
  /** Per-proxy browser cache keyed by sanitised proxy URL */
  private readonly proxyBrowsers: Map<string, Browser> = new Map();

  constructor(config?: Partial<BrowserManagerConfig>) {
    const appConfig = getConfig();
    this.config = {
      headless: config?.headless ?? appConfig.puppeteer.headless,
      timeout: config?.timeout ?? appConfig.puppeteer.timeoutMs,
      navigationTimeout: config?.navigationTimeout ?? appConfig.puppeteer.navigationTimeoutMs,
      userAgent: config?.userAgent,
      executablePath: config?.executablePath ?? appConfig.puppeteer.executablePath,
    };
  }

  async getBrowser(): Promise<Browser> {
    if (this.isClosing) {
      throw new Error('Browser manager is closing');
    }

    if (this.browser === null || !this.browser.isConnected()) {
      this.browser = await this.launchBrowser();
    }

    return this.browser;
  }

  private async launchBrowser(proxyUrl?: string): Promise<Browser> {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
      // Prevents ERR_HTTP2_PROTOCOL_ERROR rejections from CDNs that fingerprint headless Chrome
      '--disable-http2',
      '--disable-features=NetworkService,NetworkServiceInProcess',
      // Reduce automated-browser detection signals
      '--disable-infobars',
      '--ignore-certificate-errors',
      '--lang=en-US,en',
    ];

    if (proxyUrl !== undefined && proxyUrl !== '') {
      // Strip credentials from args — they are set via page.authenticate() later
      try {
        const parsed = new URL(proxyUrl);
        parsed.username = '';
        parsed.password = '';
        args.push(`--proxy-server=${parsed.toString()}`);
      } catch {
        logger.warn('Invalid proxy URL — ignoring proxy for this browser', { proxyUrl });
      }
    }

    const launchOptions: PuppeteerLaunchOptions = {
      headless: this.config.headless,
      args,
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
      ...(this.config.executablePath !== undefined && this.config.executablePath !== ''
        ? { executablePath: this.config.executablePath }
        : {}),
    };

    logger.info('Launching browser', { proxied: proxyUrl !== undefined && proxyUrl !== '' });
    const browser = await puppeteer.launch(launchOptions);

    browser.on('disconnected', () => {
      logger.warn('Browser disconnected');
      if (proxyUrl !== undefined && proxyUrl !== '') {
        this.proxyBrowsers.delete(proxyUrl);
      } else {
        this.browser = null;
      }
    });

    return browser;
  }

  async createPage(options?: PageOptions): Promise<Page> {
    if (this.isClosing) {
      throw new Error('Browser manager is closing');
    }

    // Resolve proxy URL: explicit option > AsyncLocalStorage context > none
    const contextProxy = getProxyContext().proxyUrl;
    const resolvedProxy =
      options?.proxyUrl !== undefined
        ? options.proxyUrl   // explicit ('' = force direct)
        : (contextProxy ?? undefined);

    const useProxy = resolvedProxy !== undefined && resolvedProxy !== '';
    const browser = useProxy
      ? await this.getProxyBrowser(resolvedProxy as string)
      : await this.getBrowser();

    const page = await browser.newPage();

    page.setDefaultTimeout(this.config.timeout);
    page.setDefaultNavigationTimeout(this.config.navigationTimeout);

    // Rotate between several current Chrome UA strings to reduce fingerprinting
    const UA_POOL = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    ];
    const userAgent =
      options?.userAgent ??
      this.config.userAgent ??
      UA_POOL[Math.floor(Math.random() * UA_POOL.length)]!;

    await page.setUserAgent(userAgent);

    if (options?.viewport !== undefined) {
      await page.setViewport(options.viewport);
    }

    if (options?.extraHeaders !== undefined) {
      await page.setExtraHTTPHeaders(options.extraHeaders);
    }

    if (options?.blockResources !== undefined && options.blockResources.length > 0) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (options.blockResources?.includes(resourceType)) {
          void request.abort();
        } else {
          void request.continue();
        }
      });
    }

    await page.evaluateOnNewDocument(() => {
      // Hide automation indicators
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Fake a real plugin list (headless Chrome has none)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      // Fake language settings
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      // Remove Chrome headless traces in the user-agent string
      Object.defineProperty(navigator, 'userAgent', {
        get: () => window.navigator.userAgent.replace('Headless', ''),
      });
      // Hide automation-controlled Chrome features
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });

    // Authenticate with proxy credentials if present in the URL
    if (useProxy && resolvedProxy !== undefined) {
      try {
        const parsed = new URL(resolvedProxy as string);
        if (parsed.username && parsed.password) {
          await page.authenticate({
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
          });
        }
      } catch {
        // Malformed proxy URL — already warned during browser launch
      }
    }

    return page;
  }

  /**
   * Get or create a browser bound to a specific proxy URL.
   * Reuses an existing healthy browser when possible.
   */
  private async getProxyBrowser(proxyUrl: string): Promise<Browser> {
    const existing = this.proxyBrowsers.get(proxyUrl);
    if (existing !== undefined && existing.isConnected()) {
      return existing;
    }
    const browser = await this.launchBrowser(proxyUrl);
    this.proxyBrowsers.set(proxyUrl, browser);
    return browser;
  }

  async closePage(page: Page): Promise<void> {
    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      logger.warn('Error closing page', { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async close(): Promise<void> {
    this.isClosing = true;

    if (this.browser !== null) {
      try {
        await this.browser.close();
        logger.info('Browser closed');
      } catch (error) {
        logger.warn('Error closing browser', { error: error instanceof Error ? error.message : 'Unknown error' });
      }
      this.browser = null;
    }

    // Close all proxy-specific browsers
    for (const [proxyUrl, proxyBrowser] of this.proxyBrowsers.entries()) {
      try {
        await proxyBrowser.close();
      } catch {
        // ignore
      }
      this.proxyBrowsers.delete(proxyUrl);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const browser = await this.getBrowser();
      return browser.isConnected();
    } catch {
      return false;
    }
  }
}

let browserManagerInstance: BrowserManager | null = null;

export function getBrowserManager(): BrowserManager {
  if (browserManagerInstance === null) {
    browserManagerInstance = new BrowserManager();
  }
  return browserManagerInstance;
}

export async function closeBrowserManager(): Promise<void> {
  if (browserManagerInstance !== null) {
    await browserManagerInstance.close();
    browserManagerInstance = null;
  }
}

export { BrowserManager };
