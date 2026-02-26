// Metrics types are exported from types/index.js
// Logger available via getLogger() from ./logger.js if needed

interface MetricsCollector {
  incrementCounter(name: string, labels?: Record<string, string>): void;
  decrementCounter(name: string, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
  getMetrics(): MetricsSnapshot;
}

interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

interface MetricsSnapshot {
  counters: Map<string, MetricValue[]>;
  gauges: Map<string, MetricValue[]>;
  histograms: Map<string, number[]>;
}

class InMemoryMetricsCollector implements MetricsCollector {
  private counters: Map<string, Map<string, MetricValue>> = new Map();
  private gauges: Map<string, Map<string, MetricValue>> = new Map();
  private histograms: Map<string, number[]> = new Map();

  private getLabelKey(labels?: Record<string, string>): string {
    if (labels === undefined || Object.keys(labels).length === 0) {
      return '__default__';
    }
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
  }

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const labelKey = this.getLabelKey(labels);
    const counterMap = this.counters.get(name) ?? new Map<string, MetricValue>();

    const existing = counterMap.get(labelKey);
    const newValue: MetricValue = {
      value: (existing?.value ?? 0) + 1,
      labels: labels ?? {},
      timestamp: new Date(),
    };

    counterMap.set(labelKey, newValue);
    this.counters.set(name, counterMap);
  }

  decrementCounter(name: string, labels?: Record<string, string>): void {
    const labelKey = this.getLabelKey(labels);
    const counterMap = this.counters.get(name) ?? new Map<string, MetricValue>();

    const existing = counterMap.get(labelKey);
    const newValue: MetricValue = {
      value: Math.max(0, (existing?.value ?? 0) - 1),
      labels: labels ?? {},
      timestamp: new Date(),
    };

    counterMap.set(labelKey, newValue);
    this.counters.set(name, counterMap);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const labelKey = this.getLabelKey(labels);
    const gaugeMap = this.gauges.get(name) ?? new Map<string, MetricValue>();

    gaugeMap.set(labelKey, {
      value,
      labels: labels ?? {},
      timestamp: new Date(),
    });

    this.gauges.set(name, gaugeMap);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const fullName = labels !== undefined ? `${name}:${this.getLabelKey(labels)}` : name;
    const values = this.histograms.get(fullName) ?? [];
    values.push(value);

    if (values.length > 10000) {
      values.shift();
    }

    this.histograms.set(fullName, values);
  }

  recordLatency(name: string, durationMs: number, labels?: Record<string, string>): void {
    this.recordHistogram(name, durationMs, labels);
  }

  getMetrics(): MetricsSnapshot {
    const counters = new Map<string, MetricValue[]>();
    const gauges = new Map<string, MetricValue[]>();

    for (const [name, valueMap] of this.counters.entries()) {
      counters.set(name, Array.from(valueMap.values()));
    }

    for (const [name, valueMap] of this.gauges.entries()) {
      gauges.set(name, Array.from(valueMap.values()));
    }

    return {
      counters,
      gauges,
      histograms: new Map(this.histograms),
    };
  }

  // Alias for backward compatibility
  getAllMetrics(): MetricsSnapshot {
    return this.getMetrics();
  }

  getCounterValue(name: string, labels?: Record<string, string>): number {
    const labelKey = this.getLabelKey(labels);
    const counterMap = this.counters.get(name);
    return counterMap?.get(labelKey)?.value ?? 0;
  }

  getGaugeValue(name: string, labels?: Record<string, string>): number {
    const labelKey = this.getLabelKey(labels);
    const gaugeMap = this.gauges.get(name);
    return gaugeMap?.get(labelKey)?.value ?? 0;
  }

  getHistogramStats(name: string): { avg: number; min: number; max: number; count: number } | null {
    const values = this.histograms.get(name);
    if (values === undefined || values.length === 0) {
      return null;
    }

    const sum = values.reduce((acc, v) => acc + v, 0);
    return {
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

let metricsInstance: InMemoryMetricsCollector | null = null;

export function getMetricsCollector(): InMemoryMetricsCollector {
  if (metricsInstance === null) {
    metricsInstance = new InMemoryMetricsCollector();
  }
  return metricsInstance;
}

export const MetricNames = {
  MONITORING_CHECKS_TOTAL: 'monitoring_checks_total',
  MONITORING_CHECKS: 'monitoring_checks',
  MONITORING_ERRORS_TOTAL: 'monitoring_errors_total',
  MONITORING_ERRORS: 'monitoring_errors',
  MONITORING_STOCK_CHANGES: 'monitoring_stock_changes_total',
  MONITORING_RESPONSE_TIME: 'monitoring_response_time_ms',
  IN_STOCK_DETECTIONS: 'in_stock_detections_total',
  ADAPTER_LATENCY: 'adapter_latency_ms',
  ACTIVE_SKUS: 'active_skus',
  PAUSED_SKUS: 'paused_skus',
  CHECKOUT_ATTEMPTS_TOTAL: 'checkout_attempts_total',
  CHECKOUT_SUCCESS_TOTAL: 'checkout_success_total',
  CHECKOUT_FAILED_TOTAL: 'checkout_failed_total',
  QUEUE_JOBS_WAITING: 'queue_jobs_waiting',
  QUEUE_JOBS_ACTIVE: 'queue_jobs_active',
  QUEUE_JOBS_FAILED: 'queue_jobs_failed',
  CIRCUIT_BREAKER_STATE: 'circuit_breaker_state',
  DATABASE_CONNECTIONS_ACTIVE: 'database_connections_active',
  REDIS_CONNECTIONS_ACTIVE: 'redis_connections_active',
  HTTP_REQUESTS_TOTAL: 'http_requests_total',
  HTTP_REQUEST_DURATION: 'http_request_duration_ms',
  // Additional metrics
  API_LATENCY: 'api_latency_ms',
  CHECKOUT_ATTEMPTS: 'checkout_attempts',
  CHECKOUT_SUCCESSES: 'checkout_successes',
  CHECKOUT_FAILURES: 'checkout_failures',
  ALERTS_GENERATED: 'alerts_generated',
  ACTIVE_ALERTS: 'active_alerts',
} as const;

export type MetricName = (typeof MetricNames)[keyof typeof MetricNames];

export { MetricsCollector, MetricsSnapshot, MetricValue, InMemoryMetricsCollector };
