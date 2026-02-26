/**
 * Critical tests for the in-process poller.
 * Verifies: SKU scheduling, deduplication, sync, and status reporting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockSKU } from '../fixtures';
import { StockStatus, MonitoringStatus } from '../../types/index.js';

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../../observability/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(),
    debug: vi.fn(), child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../observability/health.js', () => ({
  getHealthCheck: () => ({ register: vi.fn() }),
}));

const mockFindActive = vi.fn().mockResolvedValue([]);
vi.mock('../../persistence/repositories/index.js', () => ({
  getSKURepository: () => ({ findActiveForMonitoring: mockFindActive }),
}));

vi.mock('../../adapters/factory.js', () => ({
  getAdapterFactory: () => ({
    getAdapter: () => ({
      checkProduct: vi.fn().mockResolvedValue({
        success: true,
        productInfo: { stockStatus: StockStatus.IN_STOCK, price: 9.99, name: 'Test Product' },
      }),
    }),
  }),
}));

vi.mock('../../services/alert.service.js', () => ({
  getAlertService: () => ({ createAlert: vi.fn() }),
}));

vi.mock('../../persistence/database.js', () => ({
  getDatabase: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────
describe('InProcessPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with correct active SKU count', async () => {
    const sku1 = createMockSKU({ id: 'sku-1', monitoringStatus: MonitoringStatus.ACTIVE, pollingIntervalMs: 60000 });
    const sku2 = createMockSKU({ id: 'sku-2', monitoringStatus: MonitoringStatus.ACTIVE, pollingIntervalMs: 30000 });
    mockFindActive.mockResolvedValueOnce([sku1, sku2]);

    const { startInProcessPoller, stopInProcessPoller, getPollerStatus } = await import('../../queue/poller.js');

    await startInProcessPoller();

    expect(getPollerStatus()).toHaveLength(2);
    expect(getPollerStatus().map((j) => j.skuId)).toContain('sku-1');
    expect(getPollerStatus().map((j) => j.skuId)).toContain('sku-2');

    stopInProcessPoller();
  });

  it('starts with no SKUs when DB is empty', async () => {
    mockFindActive.mockResolvedValueOnce([]);

    const { startInProcessPoller, stopInProcessPoller, getPollerStatus } = await import('../../queue/poller.js');

    await startInProcessPoller();
    expect(getPollerStatus()).toHaveLength(0);

    stopInProcessPoller();
  });

  it('notifyPollerSKUActivated schedules a new SKU', async () => {
    mockFindActive.mockResolvedValueOnce([]);

    const { startInProcessPoller, stopInProcessPoller, notifyPollerSKUActivated, getPollerStatus } = await import('../../queue/poller.js');

    await startInProcessPoller();
    expect(getPollerStatus()).toHaveLength(0);

    const sku = createMockSKU({ id: 'sku-new', monitoringStatus: MonitoringStatus.ACTIVE, pollingIntervalMs: 60000 });
    notifyPollerSKUActivated(sku);
    expect(getPollerStatus()).toHaveLength(1);

    stopInProcessPoller();
  });

  it('notifyPollerSKUDeactivated removes a SKU', async () => {
    const sku = createMockSKU({ id: 'sku-3', monitoringStatus: MonitoringStatus.ACTIVE, pollingIntervalMs: 60000 });
    mockFindActive.mockResolvedValueOnce([sku]);

    const { startInProcessPoller, stopInProcessPoller, notifyPollerSKUDeactivated, getPollerStatus } = await import('../../queue/poller.js');

    await startInProcessPoller();
    expect(getPollerStatus()).toHaveLength(1);

    notifyPollerSKUDeactivated('sku-3');
    expect(getPollerStatus()).toHaveLength(0);

    stopInProcessPoller();
  });

  it('does not schedule duplicate jobs for same SKU', async () => {
    const sku = createMockSKU({ id: 'sku-dup', monitoringStatus: MonitoringStatus.ACTIVE, pollingIntervalMs: 60000 });
    mockFindActive.mockResolvedValueOnce([sku]);

    const { startInProcessPoller, stopInProcessPoller, notifyPollerSKUActivated, getPollerStatus } = await import('../../queue/poller.js');

    await startInProcessPoller();
    notifyPollerSKUActivated(sku); // call twice - should not duplicate
    notifyPollerSKUActivated(sku);
    expect(getPollerStatus()).toHaveLength(1);

    stopInProcessPoller();
  });

  it('stopInProcessPoller clears all jobs', async () => {
    const sku1 = createMockSKU({ id: 'sku-10', monitoringStatus: MonitoringStatus.ACTIVE, pollingIntervalMs: 60000 });
    const sku2 = createMockSKU({ id: 'sku-11', monitoringStatus: MonitoringStatus.ACTIVE, pollingIntervalMs: 60000 });
    mockFindActive.mockResolvedValueOnce([sku1, sku2]);

    const { startInProcessPoller, stopInProcessPoller, getPollerStatus } = await import('../../queue/poller.js');

    await startInProcessPoller();
    expect(getPollerStatus()).toHaveLength(2);

    stopInProcessPoller();
    expect(getPollerStatus()).toHaveLength(0);
  });

  it('getPollerHeartbeat returns running state', async () => {
    mockFindActive.mockResolvedValueOnce([]);

    const { startInProcessPoller, stopInProcessPoller, getPollerHeartbeat } = await import('../../queue/poller.js');

    await startInProcessPoller();
    const beat = getPollerHeartbeat();
    expect(beat.isRunning).toBe(true);
    expect(beat.activeJobs).toBe(0);
    expect(typeof beat.lastGlobalHeartbeat).toBe('number');

    stopInProcessPoller();
  });
});
