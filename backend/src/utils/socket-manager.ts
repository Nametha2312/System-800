/**
 * Socket.io Manager — Singleton for real-time event broadcasting.
 * Attach to the HTTP server via attachSocketServer() right after createApp().
 */
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { getLogger } from '../observability/logger.js';
import { getConfig } from '../config/index.js';

const logger = getLogger().child({ component: 'SocketManager' });

export interface AlertSocketPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  skuId: string | null;
  severity: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface MonitoringUpdatePayload {
  skuId: string;
  productId: string;
  retailer: string;
  stockStatus: string;
  price: number | null;
  checkedAt: string;
}

export enum SocketEvents {
  ALERT_NEW = 'alert:new',
  ALERT_ACKNOWLEDGED = 'alert:acknowledged',
  MONITORING_UPDATE = 'monitoring:update',
  CHECKOUT_STATUS = 'checkout:status',
  SKU_STOCK_CHANGE = 'sku:stock_change',
  WORKER_STATUS = 'worker:status',
}

let socketServer: SocketIOServer | null = null;

/**
 * Attaches Socket.io to the HTTP server. Call once on startup.
 */
export function attachSocketServer(httpServer: HttpServer): SocketIOServer {
  if (socketServer !== null) {
    return socketServer;
  }

  const config = getConfig();
  const origins = config.cors.origin.split(',').map((o: string) => o.trim());

  socketServer = new SocketIOServer(httpServer, {
    cors: {
      origin: origins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  socketServer.on('connection', (socket: Socket) => {
    logger.info('Socket client connected', { socketId: socket.id });

    // Client can join user-specific room for targeted alerts
    socket.on('join:user', (userId: string) => {
      if (typeof userId === 'string' && userId.length > 0) {
        void socket.join(`user:${userId}`);
        logger.debug('Socket joined user room', { socketId: socket.id, userId });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.debug('Socket client disconnected', { socketId: socket.id, reason });
    });

    socket.on('error', (err) => {
      logger.error('Socket error', err instanceof Error ? err : new Error(String(err)), {
        socketId: socket.id,
      });
    });
  });

  logger.info('Socket.io server attached', { origins });
  return socketServer;
}

/**
 * Get the current Socket.io server instance.
 */
export function getSocketServer(): SocketIOServer | null {
  return socketServer;
}

/**
 * Broadcast an event to ALL connected clients.
 */
export function broadcastToAll(event: string, payload: unknown): void {
  if (socketServer === null) {
    return;
  }
  socketServer.emit(event, payload);
}

/**
 * Broadcast to a specific user (if they joined their room).
 */
export function broadcastToUser(userId: string, event: string, payload: unknown): void {
  if (socketServer === null) {
    return;
  }
  socketServer.to(`user:${userId}`).emit(event, payload);
  // Also broadcast globally so dashboards with no user context receive it
  socketServer.emit(event, payload);
}

/**
 * Emit a new alert to all connected clients.
 */
export function emitNewAlert(alert: AlertSocketPayload): void {
  broadcastToAll(SocketEvents.ALERT_NEW, alert);
  logger.debug('Alert emitted via socket', { alertId: alert.id, type: alert.type });
}

/**
 * Emit a monitoring update (stock check result) to all clients.
 */
export function emitMonitoringUpdate(update: MonitoringUpdatePayload): void {
  broadcastToAll(SocketEvents.MONITORING_UPDATE, update);
}

/**
 * Emit a checkout status update.
 */
export function emitCheckoutStatus(payload: {
  attemptId: string;
  skuId: string;
  status: string;
  orderNumber?: string | null;
  error?: string | null;
}): void {
  broadcastToAll(SocketEvents.CHECKOUT_STATUS, payload);
}

/**
 * Emit stock change event.
 */
export function emitStockChange(payload: {
  skuId: string;
  retailer: string;
  productName: string;
  previousStatus: string;
  newStatus: string;
  price: number | null;
}): void {
  broadcastToAll(SocketEvents.SKU_STOCK_CHANGE, payload);
}
