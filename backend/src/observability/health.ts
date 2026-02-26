import { ComponentHealth, SystemHealth } from '../types/index.js';
import { getLogger } from './logger.js';

const logger = getLogger();

export type HealthCheckFn = () => Promise<ComponentHealth>;

interface HealthCheckRegistry {
  register(name: string, check: HealthCheckFn): void;
  unregister(name: string): void;
  runAll(): Promise<SystemHealth>;
  runCheck(name: string): Promise<ComponentHealth | null>;
}

class HealthCheckService implements HealthCheckRegistry {
  private readonly checks: Map<string, HealthCheckFn> = new Map();
  private readonly startTime: Date = new Date();

  register(name: string, check: HealthCheckFn): void {
    if (this.checks.has(name)) {
      logger.warn(`Health check "${name}" already registered, overwriting`);
    }
    this.checks.set(name, check);
    logger.debug(`Health check "${name}" registered`);
  }

  registerCheck(config: { name: string; check: () => Promise<{ healthy: boolean; message: string; latency?: number }> }): void {
    this.register(config.name, async (): Promise<ComponentHealth> => {
      const result = await config.check();
      return {
        name: config.name,
        status: result.healthy ? 'healthy' : 'unhealthy',
        message: result.message,
        latencyMs: result.latency,
        lastCheckedAt: new Date(),
      };
    });
  }

  async getStatus(): Promise<SystemHealth> {
    return this.runAll();
  }

  unregister(name: string): void {
    if (this.checks.delete(name)) {
      logger.debug(`Health check "${name}" unregistered`);
    }
  }

  async runAll(): Promise<SystemHealth> {
    const components: ComponentHealth[] = [];
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    const checkPromises = Array.from(this.checks.entries()).map(async ([name, check]) => {
      try {
        const result = await Promise.race([
          check(),
          new Promise<ComponentHealth>((_, reject) => {
            const timeoutId = setTimeout(() => reject(new Error('Health check timeout')), 5000);
            // Note: in Node.js, timeoutId is a Timeout object, but we don't need to unref it here
            void timeoutId;
          }),
        ]);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Health check "${name}" failed`, error instanceof Error ? error : undefined);
        return {
          name,
          status: 'unhealthy' as const,
          message: errorMessage,
          lastCheckedAt: new Date(),
        };
      }
    });

    const results = await Promise.all(checkPromises);

    for (const result of results) {
      components.push(result);

      if (result.status === 'unhealthy') {
        overallStatus = 'unhealthy';
      } else if (result.status === 'degraded' && overallStatus !== 'unhealthy') {
        overallStatus = 'degraded';
      }
    }

    const uptimeMs = Date.now() - this.startTime.getTime();

    return {
      status: overallStatus,
      timestamp: new Date(),
      uptime: uptimeMs,
      components,
    };
  }

  async runCheck(name: string): Promise<ComponentHealth | null> {
    const check = this.checks.get(name);
    if (check === undefined) {
      return null;
    }

    try {
      return await check();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Health check "${name}" failed`, error instanceof Error ? error : undefined);
      return {
        name,
        status: 'unhealthy',
        message: errorMessage,
        lastCheckedAt: new Date(),
      };
    }
  }

  getRegisteredChecks(): string[] {
    return Array.from(this.checks.keys());
  }

  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }
}

let healthCheckInstance: HealthCheckService | null = null;

export function getHealthCheckService(): HealthCheckService {
  if (healthCheckInstance === null) {
    healthCheckInstance = new HealthCheckService();
  }
  return healthCheckInstance;
}

export function createDatabaseHealthCheck(
  checkConnection: () => Promise<boolean>,
): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const startTime = Date.now();
    try {
      const isConnected = await checkConnection();
      const latencyMs = Date.now() - startTime;

      return {
        name: 'database',
        status: isConnected ? 'healthy' : 'unhealthy',
        latencyMs,
        message: isConnected ? 'Connected' : 'Connection failed',
        lastCheckedAt: new Date(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        name: 'database',
        status: 'unhealthy',
        latencyMs,
        message: errorMessage,
        lastCheckedAt: new Date(),
      };
    }
  };
}

export function createRedisHealthCheck(
  pingRedis: () => Promise<string>,
): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const startTime = Date.now();
    try {
      const result = await pingRedis();
      const latencyMs = Date.now() - startTime;

      return {
        name: 'redis',
        status: result === 'PONG' ? 'healthy' : 'degraded',
        latencyMs,
        message: result === 'PONG' ? 'Connected' : `Unexpected response: ${result}`,
        lastCheckedAt: new Date(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        name: 'redis',
        status: 'unhealthy',
        latencyMs,
        message: errorMessage,
        lastCheckedAt: new Date(),
      };
    }
  };
}

export function createQueueHealthCheck(
  getQueueStats: () => Promise<{ waiting: number; active: number; failed: number }>,
  maxWaiting: number = 1000,
): HealthCheckFn {
  return async (): Promise<ComponentHealth> => {
    const startTime = Date.now();
    try {
      const stats = await getQueueStats();
      const latencyMs = Date.now() - startTime;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let message = `Waiting: ${stats.waiting}, Active: ${stats.active}, Failed: ${stats.failed}`;

      if (stats.waiting > maxWaiting) {
        status = 'degraded';
        message = `Queue backlog warning: ${stats.waiting} jobs waiting`;
      }

      return {
        name: 'queue',
        status,
        latencyMs,
        message,
        lastCheckedAt: new Date(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        name: 'queue',
        status: 'unhealthy',
        latencyMs,
        message: errorMessage,
        lastCheckedAt: new Date(),
      };
    }
  };
}

// Export aliases for backward compatibility
export const getHealthCheck = getHealthCheckService;
export type HealthCheck = HealthCheckService;

export { HealthCheckRegistry, HealthCheckService };
