import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { HealthStatus, QueueStats, WorkerStatus, SystemInfo } from '@/types';

export const systemKeys = {
  all: ['system'] as const,
  health: () => [...systemKeys.all, 'health'] as const,
  healthDetailed: () => [...systemKeys.all, 'health', 'detailed'] as const,
  queues: () => [...systemKeys.all, 'queues'] as const,
  workers: () => [...systemKeys.all, 'workers'] as const,
  scheduler: () => [...systemKeys.all, 'scheduler'] as const,
  info: () => [...systemKeys.all, 'info'] as const,
  metrics: () => [...systemKeys.all, 'metrics'] as const,
};

export function useHealthCheck() {
  return useQuery({
    queryKey: systemKeys.health(),
    queryFn: async () => {
      const { data } = await api.get<HealthStatus>('/system/health');
      return data;
    },
    refetchInterval: 30000,
  });
}

export function useDetailedHealthCheck() {
  return useQuery({
    queryKey: systemKeys.healthDetailed(),
    queryFn: async () => {
      const { data } = await api.get<HealthStatus>('/system/health/detailed');
      return data;
    },
    refetchInterval: 30000,
  });
}

export function useQueueStats() {
  return useQuery({
    queryKey: systemKeys.queues(),
    queryFn: async () => {
      const { data } = await api.get<{ data: QueueStats[] }>('/system/queues');
      return data.data;
    },
    refetchInterval: 10000,
  });
}

export function useWorkerStatus() {
  return useQuery({
    queryKey: systemKeys.workers(),
    queryFn: async () => {
      const { data } = await api.get<{ data: WorkerStatus[] }>('/system/workers');
      return data.data;
    },
    refetchInterval: 10000,
  });
}

export function useSchedulerStatus() {
  return useQuery({
    queryKey: systemKeys.scheduler(),
    queryFn: async () => {
      const { data } = await api.get<{ data: { scheduledJobCount: number } }>('/system/scheduler');
      return data.data;
    },
    refetchInterval: 30000,
  });
}

export function useSystemInfo() {
  return useQuery({
    queryKey: systemKeys.info(),
    queryFn: async () => {
      const { data } = await api.get<{ data: SystemInfo }>('/system/info');
      return data.data;
    },
    refetchInterval: 30000,
  });
}

export function useMetrics() {
  return useQuery({
    queryKey: systemKeys.metrics(),
    queryFn: async () => {
      const { data } = await api.get<{ data: unknown }>('/system/metrics');
      return data.data;
    },
    refetchInterval: 30000,
  });
}

// Alias for compatibility
export const useHealth = useDetailedHealthCheck;

