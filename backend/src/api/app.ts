import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import routes from './routes/index.js';
import {
  errorMiddleware,
  notFoundMiddleware,
  requestIdMiddleware,
  requestLoggerMiddleware,
} from './middleware/index.js';
import { getConfig } from '../config/index.js';
import { getLogger } from '../observability/logger.js';

export function createApp(): Application {
  const config = getConfig();
  const logger = getLogger().child({ component: 'ExpressApp' });

  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
  }));

  app.use(cors({
    origin: config.cors.origin.split(','),
    credentials: config.cors.credentials,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  }));

  app.use(compression());

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use(requestIdMiddleware());
  app.use(requestLoggerMiddleware());

  app.use('/api/v1', routes);

  app.get('/', (req, res) => {
    res.json({
      name: 'Retail Monitor API',
      version: process.env['npm_package_version'] ?? '1.0.0',
      status: 'running',
    });
  });

  app.use(notFoundMiddleware());
  app.use(errorMiddleware());

  logger.info('Express app created');

  return app;
}
