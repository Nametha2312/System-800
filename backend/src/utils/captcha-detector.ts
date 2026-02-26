/**
 * CAPTCHA and Bot-Blocking Detection Utility
 * Detects CAPTCHA challenges, Cloudflare blocks, and anti-bot measures.
 */
import { Page } from 'puppeteer';
import { getLogger } from '../observability/logger.js';

const logger = getLogger().child({ component: 'CaptchaDetector' });

export class CaptchaDetectedError extends Error {
  constructor(message: string = 'CAPTCHA challenge detected') {
    super(message);
    this.name = 'CaptchaDetectedError';
  }
}

export class BlockedError extends Error {
  constructor(message: string = 'Request blocked by site') {
    super(message);
    this.name = 'BlockedError';
  }
}

/** Text/selector signals for CAPTCHA presence */
const CAPTCHA_SIGNALS = {
  text: [
    'verify you are human',
    'verify you\'re human',
    'i am not a robot',
    'i\'m not a robot',
    'prove you are human',
    'complete the captcha',
    'human verification',
    'security check',
    'please verify',
    'are you a robot',
    'bot protection',
    // Amazon-specific CAPTCHA signals
    'robot check',
    'enter the characters you see below',
    'sorry, we just need to make sure you\'re not a robot',
  ],
  selectors: [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="captcha"]',
    '.g-recaptcha',
    '.h-captcha',
    '#captcha',
    '[data-sitekey]',
    '.cf-challenge-form',
    '#challenge-form',
    '.captcha-container',
    '#recaptcha',
    '[class*="captcha"]',
    '[id*="captcha"]',
    // Amazon-specific CAPTCHA selectors
    'form[action="/errors/validateCaptcha"]',
    '#captchacharacters',
  ],
};

/** Signals for being blocked by the site */
const BLOCKING_SIGNALS = {
  text: [
    'access denied',
    'you have been blocked',
    'your request has been blocked',
    'rate limited',
    'too many requests',
    'unusual traffic',
    'automated access',
    'bot detected',
    'cloudflare',
  ],
  urlPatterns: [
    /\/blocked/i,
    /\/captcha/i,
    /\/challenge/i,
    /\/error\/403/i,
    /\/errors\/blocked/i,
    // Amazon CAPTCHA redirect
    /\/errors\/validateCaptcha/i,
  ],
  statusCodes: [403, 429, 503],
};

/**
 * Checks the current page for CAPTCHA or blocking signals.
 * Throws CaptchaDetectedError or BlockedError if detected.
 */
export async function detectCaptchaOrBlock(page: Page): Promise<void> {
  const url = page.url();

  // Check URL patterns for blocking
  for (const pattern of BLOCKING_SIGNALS.urlPatterns) {
    if (pattern.test(url)) {
      logger.warn('BLOCKED: URL pattern match', { url, pattern: pattern.toString() });
      throw new BlockedError(`Blocked page detected at URL: ${url}`);
    }
  }

  // Check page title and body text
  const { title, bodyText, hasCaptchaSelectors, hasBlockingText, hasCaptchaText } =
    await page.evaluate(
      (captchaSignals, blockingSignals) => {
        const body = (document.body?.textContent ?? '').toLowerCase();
        const titleText = (document.title ?? '').toLowerCase();

        const hasCaptcha = captchaSignals.text.some(
          (t) => body.includes(t) || titleText.includes(t),
        );
        const hasBlock = blockingSignals.text.some(
          (t) => body.includes(t) || titleText.includes(t),
        );
        const hasSelectors = captchaSignals.selectors.some(
          (sel) => document.querySelector(sel) !== null,
        );

        return {
          title: document.title,
          bodyText: body.substring(0, 200),
          hasCaptchaSelectors: hasSelectors,
          hasBlockingText: hasBlock,
          hasCaptchaText: hasCaptcha,
        };
      },
      CAPTCHA_SIGNALS,
      BLOCKING_SIGNALS,
    );

  if (hasCaptchaSelectors || hasCaptchaText) {
    logger.warn('CAPTCHA DETECTED', { url, title, bodyPreview: bodyText });
    throw new CaptchaDetectedError(
      `CAPTCHA challenge detected on page: ${url} (${title})`,
    );
  }

  if (hasBlockingText) {
    logger.warn('BLOCKED: Anti-bot page detected', { url, title });
    throw new BlockedError(`Anti-bot blocking detected on page: ${url} (${title})`);
  }
}

/**
 * Waits for navigation and then checks for CAPTCHA/block.
 */
export async function safeGoto(
  page: Page,
  url: string,
  options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'; timeout?: number } = {},
): Promise<void> {
  const response = await page.goto(url, {
    waitUntil: options.waitUntil ?? 'domcontentloaded',
    timeout: options.timeout ?? 30000,
  });

  // Check HTTP status for blocks
  if (response !== null) {
    const status = response.status();
    if (BLOCKING_SIGNALS.statusCodes.includes(status)) {
      logger.warn('HTTP blocking status detected', { url, status });
      if (status === 429) throw new BlockedError(`Rate limited (429) at ${url}`);
      if (status === 403) throw new BlockedError(`Forbidden (403) at ${url}`);
    }
  }

  await detectCaptchaOrBlock(page);
}

/**
 * Safely clicks a selector, with CAPTCHA check before and after.
 */
export async function safeClick(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
  // Brief pause then re-check for CAPTCHA
  await new Promise((r) => setTimeout(r, 1500));
  await detectCaptchaOrBlock(page);
}

/**
 * Safely types into a selector.
 */
export async function safeType(
  page: Page,
  selector: string,
  text: string,
  timeout = 10000,
): Promise<void> {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, text, { delay: 50 });
}

/**
 * Try multiple selectors, click the first one that exists.
 */
export async function clickFirst(
  page: Page,
  selectors: string[],
  timeout = 8000,
): Promise<string | null> {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 2000 });
      await page.click(selector);
      await new Promise((r) => setTimeout(r, 500));
      return selector;
    } catch {
      // Try next selector
    }
  }

  // Last resort: wait for any of them
  try {
    const selectorStr = selectors.join(', ');
    await page.waitForSelector(selectorStr, { timeout });
    await page.click(selectorStr);
    return selectorStr;
  } catch {
    return null;
  }
}
