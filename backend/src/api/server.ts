import { Server } from 'http';
import { createApp } from './app.js';
import { getConfig } from '../config/index.js';
import { getLogger } from '../observability/logger.js';
import { getHealthCheck } from '../observability/health.js';
import { getPostgresClient } from '../persistence/database.js';
import { runMigrations } from '../persistence/migrations/runner.js';
import { getRedisManager } from '../queue/redis.js';
import { getQueueManager } from '../queue/queues.js';
import { getWorkerManager } from '../queue/workers.js';
import { getScheduler } from '../queue/scheduler.js';
import { startInProcessPoller, stopInProcessPoller } from '../queue/poller.js';
import { attachSocketServer } from '../utils/socket-manager.js';

let server: Server | null = null;
/** Track open connections so we can actively close them during shutdown */
let activeConnections = 0;

async function startServer(): Promise<void> {
  const config = getConfig();
  const logger = getLogger().child({ component: 'Server' });
  const skipDbConnect = process.env.SKIP_DB_CONNECT === 'true';
  const skipRedisConnect = process.env.SKIP_REDIS_CONNECT === 'true';

  try {
    logger.info('Starting server initialization');

    if (!skipDbConnect) {
      logger.info('Connecting to PostgreSQL');
      const db = getPostgresClient();
      await db.connect();

      logger.info('Running database migrations');
      await runMigrations();
    } else {
      logger.warn('Skipping database connection (SKIP_DB_CONNECT=true)');
    }

    if (!skipRedisConnect) {
      logger.info('Connecting to Redis');
      const redis = getRedisManager();
      await waitForRedis(redis);

      logger.info('Initializing queue manager');
      getQueueManager();

      logger.info('Starting workers');
      const workerManager = getWorkerManager();
      await workerManager.startAll();

      logger.info('Starting scheduler');
      const scheduler = getScheduler();
      await scheduler.start();
    } else {
      logger.warn('Skipping Redis connection (SKIP_REDIS_CONNECT=true)');
      logger.info('Starting in-process monitoring poller (Redis-free mode)');
      await startInProcessPoller();
    }

    const app = createApp();

    server = app.listen(config.port, () => {
      logger.info('Server started', {
        port: config.port,
        environment: config.env,
      });
    });

    // Production-safe timeouts: prevent slow clients from hanging connections
    server.keepAliveTimeout = 65_000;  // 65s — slightly longer than typical LB idle timeouts
    server.headersTimeout = 66_000;    // must be > keepAliveTimeout

    // Track open connection count for graceful drain
    server.on('connection', () => { activeConnections++; });
    server.on('close', () => { activeConnections = 0; });

    // Attach Socket.io for real-time alerts
    attachSocketServer(server);
    logger.info('Socket.io attached for real-time alerts');

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use. Run 'npx kill-port ${config.port}' then restart.`, { port: config.port });
      } else {
        logger.error('Server error', error);
      }
      process.exit(1);
    });

    const healthCheck = getHealthCheck();
    healthCheck.registerCheck({
      name: 'server',
      check: async () => ({
        healthy: server !== null && server.listening,
        message: server?.listening ? 'Server is listening' : 'Server is not listening',
      }),
    });

    setupGracefulShutdown();

    logger.info('Server initialization complete');
  } catch (error) {
    logger.error('Failed to start server', error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

async function waitForRedis(redis: ReturnType<typeof getRedisManager>): Promise<void> {
  const maxAttempts = 30;
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (redis.isConnected()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  throw new Error('Redis connection timeout');
}

function setupGracefulShutdown(): void {
  const logger = getLogger().child({ component: 'Shutdown' });
  const skipDbConnect = process.env.SKIP_DB_CONNECT === 'true';
  const skipRedisConnect = process.env.SKIP_REDIS_CONNECT === 'true';

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutdown signal received', { signal });

    const shutdownTimeout = setTimeout(() => {
      logger.error('Shutdown timeout, forcing exit');
      process.exit(1);
    }, 30000);

    try {
      if (server !== null) {
        logger.info('Closing HTTP server', { activeConnections });
        // Stop accepting new connections and drain idle ones immediately
        if (typeof (server as any).closeIdleConnections === 'function') {
          (server as any).closeIdleConnections();
        }
        await new Promise<void>((resolve, reject) => {
          server?.close((err) => {
            if (err !== undefined) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }

      if (!skipRedisConnect) {
        logger.info('Stopping scheduler');
        const scheduler = getScheduler();
        await scheduler.stop();

        logger.info('Stopping workers');
        const workerManager = getWorkerManager();
        await workerManager.stopAll();

        logger.info('Closing queues');
        const queueManager = getQueueManager();
        await queueManager.closeAll();

        logger.info('Disconnecting from Redis');
        const redis = getRedisManager();
        await redis.disconnect();
      } else {
        stopInProcessPoller();
      }

      if (!skipDbConnect) {
        logger.info('Disconnecting from PostgreSQL');
        const db = getPostgresClient();
        await db.disconnect();
      }

      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error instanceof Error ? error : undefined, { errorMsg: String(error) });
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error, { stack: error.stack });
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', undefined, { reason: String(reason) });
    void shutdown('unhandledRejection');
  });
}

startServer().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});

export { startServer };
