/**
 * Proxy Context — AsyncLocalStorage wrapper
 *
 * Allows the worker layer to bind a proxy URL to an async execution context
 * so the BrowserManager can transparently pick it up when creating a new page
 * — without requiring any changes to adapter method signatures.
 *
 * Usage in workers:
 *
 *   await runWithProxyContext({ proxyUrl: 'http://user:pass@host:port' }, async () => {
 *     await monitoringService.checkProduct(sku);
 *   });
 *
 * Usage in BrowserManager:
 *
 *   const { proxyUrl } = getProxyContext();
 */

import { AsyncLocalStorage } from 'async_hooks';

export interface ProxyContextStore {
  /** Full proxy URL including credentials, e.g. http://user:pass@1.2.3.4:8080 */
  readonly proxyUrl: string | null;
  /** Logical task ID used for sticky session tracking */
  readonly taskId: string | null;
}

const DEFAULT_STORE: ProxyContextStore = { proxyUrl: null, taskId: null };

const storage = new AsyncLocalStorage<ProxyContextStore>();

/**
 * Run `fn` inside an async context where the given proxy is active.
 * The proxy context is automatically cleaned up when the function resolves.
 */
export async function runWithProxyContext<T>(
  ctx: Partial<ProxyContextStore>,
  fn: () => Promise<T>,
): Promise<T> {
  const store: ProxyContextStore = {
    proxyUrl: ctx.proxyUrl ?? null,
    taskId: ctx.taskId ?? null,
  };
  return storage.run(store, fn);
}

/**
 * Get the proxy context for the current async execution chain.
 * Returns a default empty context if called outside any runWithProxyContext scope.
 */
export function getProxyContext(): ProxyContextStore {
  return storage.getStore() ?? DEFAULT_STORE;
}

/**
 * Convenience: true when a proxy URL is active in the current context.
 */
export function hasActiveProxy(): boolean {
  return (storage.getStore()?.proxyUrl ?? null) !== null;
}
