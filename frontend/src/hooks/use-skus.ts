import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { SKU, PaginatedResponse, SKUStatistics, CreateSKUInput, UpdateSKUInput } from '@/types';

export const skuKeys = {
  all: ['skus'] as const,
  lists: () => [...skuKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...skuKeys.lists(), filters] as const,
  details: () => [...skuKeys.all, 'detail'] as const,
  detail: (id: string) => [...skuKeys.details(), id] as const,
  statistics: () => [...skuKeys.all, 'statistics'] as const,
};

export function useSKUs(page = 1, limit = 20) {
  return useQuery({
    queryKey: skuKeys.list({ page, limit }),
    queryFn: async () => {
      const { data } = await api.get<{ data: SKU[]; pagination: PaginatedResponse<SKU>['pagination'] }>('/skus', {
        params: { page, limit },
      });
      return data;
    },
  });
}

export function useSKU(id: string) {
  return useQuery({
    queryKey: skuKeys.detail(id),
    queryFn: async () => {
      const { data } = await api.get<{ data: SKU }>(`/skus/${id}`);
      return data.data;
    },
    enabled: id !== '',
  });
}

export function useSKUStatistics() {
  return useQuery({
    queryKey: skuKeys.statistics(),
    queryFn: async () => {
      const { data } = await api.get<{ data: SKUStatistics }>('/skus/statistics');
      return data.data;
    },
  });
}

export function useCreateSKU() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSKUInput) => {
      const { data } = await api.post<{ data: SKU }>('/skus', input);
      return data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
    },
  });
}

export function useUpdateSKU() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateSKUInput }) => {
      const { data } = await api.put<{ data: SKU }>(`/skus/${id}`, input);
      return data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
      queryClient.setQueryData(skuKeys.detail(data.id), data);
    },
  });
}

export function useDeleteSKU() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/skus/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
    },
  });
}

export function useStartMonitoring() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ data: SKU }>(`/skus/${id}/monitoring/start`);
      return data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
      queryClient.setQueryData(skuKeys.detail(data.id), data);
    },
  });
}

export function usePauseMonitoring() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ data: SKU }>(`/skus/${id}/monitoring/pause`);
      return data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
      queryClient.setQueryData(skuKeys.detail(data.id), data);
    },
  });
}

export function useStopMonitoring() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ data: SKU }>(`/skus/${id}/monitoring/stop`);
      return data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
      queryClient.setQueryData(skuKeys.detail(data.id), data);
    },
  });
}

export function useEnableAutoCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ data: SKU }>(`/skus/${id}/auto-checkout/enable`);
      return data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
      queryClient.setQueryData(skuKeys.detail(data.id), data);
    },
  });
}

export function useDisableAutoCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ data: SKU }>(`/skus/${id}/auto-checkout/disable`);
      return data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: skuKeys.all });
      queryClient.setQueryData(skuKeys.detail(data.id), data);
    },
  });
}
