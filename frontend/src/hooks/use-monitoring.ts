import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { skuKeys } from './use-skus';

// ---------- Socket singleton ----------

let globalSocket: Socket | null = null;

// In production this is the backend Render URL; in local dev Vite proxies /socket.io
const SOCKET_URL = import.meta.env.VITE_API_URL ?? window.location.origin;

function getSocket(): Socket {
  if (globalSocket === null) {
    globalSocket = io(SOCKET_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return globalSocket;
}

// ---------- Event types (must match backend SocketEvents) ----------

export const SocketEvents = {
  ALERT_NEW: 'alert:new',
  MONITORING_UPDATE: 'monitoring:update',
  CHECKOUT_STATUS: 'checkout:status',
  SKU_STOCK_CHANGE: 'sku:stock_change',
  WORKER_STATUS: 'worker:status',
} as const;

export type MonitoringUpdatePayload = {
  skuId: string;
  action: string;
  userId?: string;
  productName?: string;
  productUrl?: string;
  retailer?: string;
  timestamp: string;
};

export type StockChangePayload = {
  skuId: string;
  productName?: string;
  previousStatus?: string;
  currentStatus?: string;
  currentPrice?: number | null;
  timestamp: string;
};

export type CheckoutStatusPayload = {
  skuId: string;
  status: string;
  orderNumber?: string;
  totalPrice?: number;
  error?: string;
  timestamp: string;
};

// ---------- useSocket hook: connects + joins user room ----------

export function useSocket() {
  const user = useAuthStore((s) => s.user);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (user === null) return;

    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit('join:user', user.id);
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [user]);

  return { socket: getSocket(), connected };
}

// ---------- useSocketEvent: subscribe to a specific socket event ----------

export function useSocketEvent<T>(event: string, handler: (data: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const fn = (data: T) => handlerRef.current(data);
    socket.on(event, fn);
    return () => { socket.off(event, fn); };
  }, [event]);
}

// ---------- useMonitoringStatus: GET /monitor/status ----------

export type MonitorStatus = {
  skuId: string;
  productName: string;
  productUrl: string;
  retailer: string;
  isMonitoring: boolean;
  monitoringStatus: string;
  autoCheckoutEnabled: boolean;
  stockStatus: string;
  currentPrice: number | null;
  lastCheckedAt: string | null;
};

export function useMonitoringStatus() {
  return useQuery({
    queryKey: ['monitor', 'status'],
    queryFn: async () => {
      const { data } = await api.get<{ data: MonitorStatus[] }>('/monitor/status');
      return data.data;
    },
    refetchInterval: 30_000,
  });
}

// ---------- useScheduleMonitoring (calls scheduler API) ----------

export function useScheduleMonitoring() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skuId: string) => {
      const { data } = await api.post<{ data: { skuId: string; monitoring: boolean; message: string } }>(
        '/monitor/start',
        { skuId },
      );
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monitor'] });
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
    },
  });
}

// ---------- useUnscheduleMonitoring (calls scheduler API) ----------

export function useUnscheduleMonitoring() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skuId: string) => {
      const { data } = await api.post<{ data: { skuId: string; monitoring: boolean; message: string } }>(
        '/monitor/stop',
        { skuId },
      );
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monitor'] });
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
    },
  });
}

// ---------- useToggleAutoCheckout ----------

export function useToggleAutoCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ skuId, enabled }: { skuId: string; enabled: boolean }) => {
      const { data } = await api.post<{ data: { skuId: string; autoCheckoutEnabled: boolean; message: string } }>(
        '/monitor/autocheckout',
        { skuId, enabled },
      );
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monitor'] });
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
    },
  });
}

// ---------- useRealTimeStockUpdates: invalidate queries on stock changes ----------

export function useRealTimeStockUpdates() {
  const queryClient = useQueryClient();

  useSocketEvent<StockChangePayload>(SocketEvents.SKU_STOCK_CHANGE, useCallback((payload) => {
    void queryClient.invalidateQueries({ queryKey: skuKeys.all });
    void queryClient.invalidateQueries({ queryKey: skuKeys.detail(payload.skuId) });
    void queryClient.invalidateQueries({ queryKey: ['monitor'] });
  }, [queryClient]));
}

// ---------- useRealTimeAlerts: invalidate alert queries on new alerts ----------

export function useRealTimeAlerts() {
  const queryClient = useQueryClient();

  useSocketEvent(SocketEvents.ALERT_NEW, useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  }, [queryClient]));
}
