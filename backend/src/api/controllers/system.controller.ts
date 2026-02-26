import { Response } from 'express';
import { getHealthCheck } from '../../observability/health.js';
import { getMetricsCollector } from '../../observability/metrics.js';
import { getQueueManager } from '../../queue/queues.js';
import { getWorkerManager } from '../../queue/workers.js';
import { getScheduler } from '../../queue/scheduler.js';
import { getPollerStatus, getPollerHeartbeat } from '../../queue/poller.js';
import { AuthenticatedRequest, asyncHandler } from '../middleware/index.js';

const isRedisMode = (): boolean => process.env.SKIP_REDIS_CONNECT !== 'true';

export const healthCheck = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const healthCheck = getHealthCheck();
  const status = await healthCheck.getStatus();
  const mem = process.memoryUsage();

  const httpStatus = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

  res.status(httpStatus).json({
    status: status.status,
    version: process.env['npm_package_version'] ?? '1.0.0',
    uptime: status.uptime,
    timestamp: new Date().toISOString(),
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
  });
});

export const healthCheckDetailed = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const health = getHealthCheck();
  const status = await health.getStatus();
  const mem = process.memoryUsage();

  const httpStatus = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

  res.status(httpStatus).json({
    ...status,
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
  });
});

export const getMetrics = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const metrics = getMetricsCollector();
  const allMetrics = metrics.getAllMetrics();

  res.json({
    data: {
      counters: Object.fromEntries(
        [...allMetrics.counters.entries()].map(([k, v]) => [k, v]),
      ),
      gauges: Object.fromEntries(
        [...allMetrics.gauges.entries()].map(([k, v]) => [k, v]),
      ),
      histograms: Object.fromEntries(
        [...allMetrics.histograms.entries()].map(([k, v]) => [k, {
          count: v.length,
          min: Math.min(...v),
          max: Math.max(...v),
          avg: v.reduce((a: number, b: number) => a + b, 0) / v.length,
          p50: percentile(v, 50),
          p95: percentile(v, 95),
          p99: percentile(v, 99),
        }]),
      ),
    },
    timestamp: new Date().toISOString(),
  });
});

export const getPrometheusMetrics = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const metrics = getMetricsCollector();
  const allMetrics = metrics.getAllMetrics();
  const lines: string[] = [];
  const now = Date.now();

  for (const [name, entries] of allMetrics.counters.entries()) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`# TYPE ${safeName} counter`);
    for (const entry of entries) {
      const labelStr = Object.keys(entry.labels).length > 0
        ? `{${Object.entries(entry.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
        : '';
      lines.push(`${safeName}${labelStr} ${entry.value} ${now}`);
    }
  }

  for (const [name, entries] of allMetrics.gauges.entries()) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`# TYPE ${safeName} gauge`);
    for (const entry of entries) {
      const labelStr = Object.keys(entry.labels).length > 0
        ? `{${Object.entries(entry.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
        : '';
      lines.push(`${safeName}${labelStr} ${entry.value} ${now}`);
    }
  }

  for (const [name, values] of allMetrics.histograms.entries()) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    if (values.length === 0) continue;
    lines.push(`# TYPE ${safeName} summary`);
    const sorted = [...values].sort((a, b) => a - b);
    lines.push(`${safeName}{quantile="0.5"} ${percentile(sorted, 50)} ${now}`);
    lines.push(`${safeName}{quantile="0.95"} ${percentile(sorted, 95)} ${now}`);
    lines.push(`${safeName}{quantile="0.99"} ${percentile(sorted, 99)} ${now}`);
    lines.push(`${safeName}_sum ${values.reduce((a, b) => a + b, 0)} ${now}`);
    lines.push(`${safeName}_count ${values.length} ${now}`);
  }

  // Add runtime process metrics
  const mem = process.memoryUsage();
  lines.push('# TYPE process_heap_bytes gauge');
  lines.push(`process_heap_bytes{type="used"} ${mem.heapUsed} ${now}`);
  lines.push(`process_heap_bytes{type="total"} ${mem.heapTotal} ${now}`);
  lines.push('# TYPE process_rss_bytes gauge');
  lines.push(`process_rss_bytes ${mem.rss} ${now}`);
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${Math.floor(process.uptime())} ${now}`);

  // Poller status
  const pollerJobs = isRedisMode() ? [] : getPollerStatus();
  const pollerBeat = isRedisMode() ? null : getPollerHeartbeat();
  lines.push('# TYPE poller_active_skus gauge');
  lines.push(`poller_active_skus ${pollerJobs.length} ${now}`);
  if (pollerBeat) {
    lines.push('# TYPE poller_heartbeat_age_seconds gauge');
    lines.push(`poller_heartbeat_age_seconds ${Math.round((now - pollerBeat.lastGlobalHeartbeat) / 1000)} ${now}`);
    lines.push('# TYPE poller_running gauge');
    lines.push(`poller_running ${pollerBeat.isRunning ? 1 : 0} ${now}`);
  }

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

export const getQueueStats = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  if (!isRedisMode()) {
    const pollerJobs = getPollerStatus();
    res.json({
      data: {
        mode: 'in-process-poller',
        activeJobs: pollerJobs.length,
        jobs: pollerJobs,
      },
    });
    return;
  }
  const queueManager = getQueueManager();
  const stats = await queueManager.getAllQueueStats();
  res.json({ data: stats });
});

export const getWorkerStatus = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  if (!isRedisMode()) {
    const pollerJobs = getPollerStatus();
    res.json({
      data: {
        mode: 'in-process-poller',
        running: true,
        monitoredSKUs: pollerJobs.length,
        workers: [],
      },
    });
    return;
  }
  const workerManager = getWorkerManager();
  const status = workerManager.getWorkerStatus();
  res.json({ data: status });
});

export const getSchedulerStatus = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  if (!isRedisMode()) {
    const pollerJobs = getPollerStatus();
    res.json({
      data: {
        mode: 'in-process-poller',
        scheduledJobCount: pollerJobs.length,
        jobs: pollerJobs,
      },
    });
    return;
  }
  const scheduler = getScheduler();
  const scheduledCount = await scheduler.getScheduledJobCount();
  res.json({ data: { scheduledJobCount: scheduledCount } });
});

export const getSystemInfo = asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
  const health = getHealthCheck();
  const status = await health.getStatus();
  const mem = process.memoryUsage();

  let queueData: unknown;
  let workerData: unknown;
  let schedulerData: unknown;

  if (isRedisMode()) {
    try {
      const queueManager = getQueueManager();
      queueData = await queueManager.getAllQueueStats();
      const workerManager = getWorkerManager();
      workerData = workerManager.getWorkerStatus();
      const scheduler = getScheduler();
      schedulerData = { scheduledJobCount: await scheduler.getScheduledJobCount() };
    } catch {
      queueData = null;
      workerData = null;
      schedulerData = null;
    }
  } else {
    const pollerJobs = getPollerStatus();
    queueData = { mode: 'in-process-poller', activeJobs: pollerJobs.length };
    workerData = { mode: 'in-process-poller', running: true, monitoredSKUs: pollerJobs.length };
    schedulerData = { mode: 'in-process-poller', scheduledJobCount: pollerJobs.length };
  }

  res.json({
    data: {
      health: {
        status: status.status,
        uptime: status.uptime,
        checks: status.components,
      },
      queues: queueData,
      workers: workerData,
      scheduler: schedulerData,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsageMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
        cpuUsage: process.cpuUsage(),
        pid: process.pid,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}
