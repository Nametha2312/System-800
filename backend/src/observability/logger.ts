import pino, { Logger as PinoLogger } from 'pino';

import { getConfig, isProduction, isDevelopment } from '../config/index.js';
import { ErrorCategory, ErrorSeverity, RetailerType } from '../types/index.js';

export interface LogContext {
  readonly skuId?: string;
  readonly retailer?: RetailerType;
  readonly jobId?: string;
  readonly userId?: string;
  readonly requestId?: string;
  readonly attemptNumber?: number;
  readonly durationMs?: number;
  readonly errorCategory?: ErrorCategory;
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  warn(context: LogContext, message: string): void;
  error(message: string, error?: Error, context?: LogContext): void;
  error(context: LogContext, message: string): void;
  fatal(message: string, error?: Error, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

function mapSeverityToLevel(severity: ErrorSeverity): pino.Level {
  const mapping: Record<ErrorSeverity, pino.Level> = {
    [ErrorSeverity.DEBUG]: 'debug',
    [ErrorSeverity.INFO]: 'info',
    [ErrorSeverity.WARNING]: 'warn',
    [ErrorSeverity.ERROR]: 'error',
    [ErrorSeverity.CRITICAL]: 'fatal',
  };
  return mapping[severity];
}

function createPinoLogger(): PinoLogger {
  const config = getConfig();

  const baseOptions: pino.LoggerOptions = {
    level: config.logging.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
      bindings: (bindings: pino.Bindings) => ({
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: 'system-800',
      }),
    },
    redact: {
      paths: [
        'password',
        'token',
        'authorization',
        'cookie',
        'encryptedPassword',
        'encryptedUsername',
        'encryptedPaymentInfo',
        'encryptedShippingInfo',
        'creditCard',
        'cvv',
        'ssn',
      ],
      censor: '[REDACTED]',
    },
  };

  if (isDevelopment() && config.logging.prettyPrint) {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(baseOptions);
}

class PinoLoggerWrapper implements Logger {
  private readonly pinoLogger: PinoLogger;

  constructor(pinoLogger: PinoLogger) {
    this.pinoLogger = pinoLogger;
  }

  debug(message: string, context?: LogContext): void {
    if (context !== undefined) {
      this.pinoLogger.debug(context, message);
    } else {
      this.pinoLogger.debug(message);
    }
  }

  info(message: string, context?: LogContext): void {
    if (context !== undefined) {
      this.pinoLogger.info(context, message);
    } else {
      this.pinoLogger.info(message);
    }
  }

  warn(messageOrContext: string | LogContext, contextOrMessage?: LogContext | string): void {
    if (typeof messageOrContext === 'object') {
      // Pino-style: (context, message)
      this.pinoLogger.warn(messageOrContext, contextOrMessage as string);
    } else if (contextOrMessage !== undefined && typeof contextOrMessage === 'object') {
      this.pinoLogger.warn(contextOrMessage, messageOrContext);
    } else {
      this.pinoLogger.warn(messageOrContext);
    }
  }

  error(messageOrContext: string | LogContext, errorOrMessage?: Error | string, context?: LogContext): void {
    if (typeof messageOrContext === 'object') {
      // Pino-style: (context, message)
      this.pinoLogger.error(messageOrContext, errorOrMessage as string);
    } else {
      const errorContext: LogContext = {
        ...context,
        ...(errorOrMessage instanceof Error && {
          error: {
            name: errorOrMessage.name,
            message: errorOrMessage.message,
            stack: isProduction() ? undefined : errorOrMessage.stack,
          },
        }),
      };
      this.pinoLogger.error(errorContext, messageOrContext);
    }
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    const errorContext: LogContext = {
      ...context,
      ...(error !== undefined && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
    };
    this.pinoLogger.fatal(errorContext, message);
  }

  child(bindings: LogContext): Logger {
    return new PinoLoggerWrapper(this.pinoLogger.child(bindings));
  }
}

let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (loggerInstance === null) {
    const pinoLogger = createPinoLogger();
    loggerInstance = new PinoLoggerWrapper(pinoLogger);
  }
  return loggerInstance;
}

export function createChildLogger(context: LogContext): Logger {
  return getLogger().child(context);
}

export { mapSeverityToLevel };
