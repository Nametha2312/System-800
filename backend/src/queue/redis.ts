import IORedis, { Redis, RedisOptions } from 'ioredis';
import { getConfig } from '../config/index.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getHealthCheck, HealthCheck } from '../observability/health.js';

export interface RedisManager {
  getClient(): Redis;
  isConnected(): boolean;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
}

class RedisManagerImpl implements RedisManager {
  private client: Redis | null = null;
  private readonly logger: Logger;
  private connected = false;
  private readonly config: any;

  constructor() {
    this.config = getConfig();
    this.logger = getLogger().child({ component: 'RedisManager' });
  }

  private ensureClient(): Redis {
    if (this.client === null) {
      const options: RedisOptions = {
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password || undefined,
        db: this.config.redis.db,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times: number): number | null => {
          if (times > 10) {
            this.logger.error('Redis connection failed after max retries');
            return null;
          }
          const delay = Math.min(times * 100, 3000);
          this.logger.warn({ attempt: times, delay }, 'Redis connection retry');
          return delay;
        },
        reconnectOnError: (err: Error): boolean | 1 | 2 => {
          const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
          if (targetErrors.some((e) => err.message.includes(e))) {
            return 2;
          }
          return false;
        },
      };

      if (this.config.redis.tls) {
        options.tls = {};
      }

      this.client = new IORedis(options);

      this.client.on('connect', () => {
        this.logger.info('Redis connecting');
      });

      this.client.on('ready', () => {
        this.connected = true;
        this.logger.info('Redis connected and ready');
        this.registerHealthCheck();
      });

      this.client.on('error', (err: Error) => {
        this.logger.error({ error: err.message }, 'Redis error');
      });

      this.client.on('close', () => {
        this.connected = false;
        this.logger.info('Redis connection closed');
      });
    }
    return this.client;
  }

  getClient(): Redis {
    return this.ensureClient();
  }

  isConnected(): boolean {
    if (this.client === null) return false;
    return this.connected && this.client.status === 'ready';
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Redis');
    if (this.client !== null) {
      await this.client.quit();
    }
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.ensureClient().ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  private registerHealthCheck(): void {
    const health = getHealthCheck();
    health.registerCheck({
      name: 'redis',
      check: async () => {
        const isHealthy = await this.ping();
        return {
          healthy: isHealthy,
          message: isHealthy ? 'Redis connection healthy' : 'Redis connection unhealthy',
          latency: 0,
        };
      },
    });
  }
}

let redisManagerInstance: RedisManager | null = null;

export function getRedisManager(): RedisManager {
  if (redisManagerInstance === null) {
    redisManagerInstance = new RedisManagerImpl();
  }
  return redisManagerInstance;
}

export { RedisManagerImpl };
