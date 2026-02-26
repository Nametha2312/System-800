import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Alert, PaginatedResponse, AlertCounts, AlertType, AlertStatus } from '@/types';

export const alertKeys = {
  all: ['alerts'] as const,
  lists: () => [...alertKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...alertKeys.lists(), filters] as const,
  unacknowledged: () => [...alertKeys.all, 'unacknowledged'] as const,
  counts: () => [...alertKeys.all, 'counts'] as const,
  detail: (id: string) => [...alertKeys.all, 'detail', id] as const,
  bySku: (skuId: string) => [...alertKeys.all, 'sku', skuId] as const,
};

interface AlertFilters {
  page?: number;
  limit?: number;
  skuId?: string;
  type?: AlertType;
  status?: AlertStatus;
  acknowledged?: boolean;
}

export function useAlerts(filters: AlertFilters = {}) {
  const { page = 1, limit = 20, ...rest } = filters;

  return useQuery({
    queryKey: alertKeys.list({ page, limit, ...rest }),
    queryFn: async () => {
      const { data } = await api.get<{ data: Alert[]; pagination: PaginatedResponse<Alert>['pagination'] }>('/alerts', {
        params: { page, limit, ...rest },
      });
      return data;
    },
  });
}

export function useUnacknowledgedAlerts() {
  return useQuery({
    queryKey: alertKeys.unacknowledged(),
    queryFn: async () => {
      const { data } = await api.get<{ data: Alert[] }>('/alerts/unacknowledged');
      return data.data;
    },
    refetchInterval: 30000,
  });
}

export function useAlertCounts() {
  return useQuery({
    queryKey: alertKeys.counts(),
    queryFn: async () => {
      const { data } = await api.get<{ data: AlertCounts }>('/alerts/counts');
      return data.data;
    },
    refetchInterval: 30000,
  });
}

export function useAlertsBySKU(skuId: string, limit = 20) {
  return useQuery({
    queryKey: alertKeys.bySku(skuId),
    queryFn: async () => {
      const { data } = await api.get<{ data: Alert[] }>(`/alerts/sku/${skuId}`, {
        params: { limit },
      });
      return data.data;
    },
    enabled: skuId !== '',
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ data: Alert }>(`/alerts/${id}/acknowledge`);
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: alertKeys.all });
    },
  });
}

export function useAcknowledgeAllAlerts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skuId?: string) => {
      const { data } = await api.post<{ message: string }>('/alerts/acknowledge-all', null, {
        params: skuId !== undefined ? { skuId } : undefined,
      });
      return data.message;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: alertKeys.all });
    },
  });
}
