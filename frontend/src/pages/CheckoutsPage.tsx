import { Card, StatusBadge, Loading } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CheckoutAttempt } from '@/types';

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface CheckoutStats {
  totalAttempts: number;
  pending: number;
  successful: number;
  failed: number;
  canceled: number;
  successRate: number;
  totalSpent: number;
}

export function CheckoutsPage() {
  const { data: attempts, isLoading: attemptsLoading } = useQuery({
    queryKey: ['checkouts'],
    queryFn: async () => {
      const resp = await api.get<{ data: CheckoutAttempt[] }>('/checkouts/my');
      return resp.data.data;
    },
    refetchInterval: 10000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['checkout-stats'],
    queryFn: async () => {
      const resp = await api.get<{ data: CheckoutStats }>('/checkouts/statistics');
      return resp.data.data;
    },
    refetchInterval: 30000,
  });

  const isLoading = attemptsLoading || statsLoading;

  if (isLoading) {
    return <Loading size="lg" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Checkout Attempts</h1>
        <p className="text-gray-400 mt-1">Automated purchase history and status</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <p className="text-sm text-gray-400">Total</p>
            <p className="text-2xl font-bold text-white">{stats.totalAttempts}</p>
          </Card>
          <Card>
            <p className="text-sm text-gray-400">Pending</p>
            <p className="text-2xl font-bold text-blue-400">{stats.pending}</p>
          </Card>
          <Card>
            <p className="text-sm text-gray-400">Succeeded</p>
            <p className="text-2xl font-bold text-green-400">{stats.successful}</p>
          </Card>
          <Card>
            <p className="text-sm text-gray-400">Failed</p>
            <p className="text-2xl font-bold text-red-400">{stats.failed}</p>
          </Card>
          <Card>
            <p className="text-sm text-gray-400">Cancelled</p>
            <p className="text-2xl font-bold text-gray-400">{stats.canceled}</p>
          </Card>
          <Card>
            <p className="text-sm text-gray-400">Success Rate</p>
            <p className="text-2xl font-bold text-white">{(stats.successRate ?? 0).toFixed(1)}%</p>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-750">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">SKU</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Started</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Completed</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Total Price</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Order #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {!attempts || attempts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No checkout attempts found
                  </td>
                </tr>
              ) : (
                attempts.map((attempt: CheckoutAttempt) => (
                  <tr key={attempt.id} className="hover:bg-gray-750 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-white font-medium">{attempt.skuId.slice(0, 8)}...</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={attempt.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-sm">{formatDate(attempt.startedAt)}</td>
                    <td className="px-4 py-3 text-gray-400 text-sm">
                      {attempt.completedAt ? formatDate(attempt.completedAt) : '-'}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {attempt.totalPrice != null ? `$${attempt.totalPrice.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-sm font-mono">
                      {attempt.orderNumber ?? '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {attempts && attempts.some((a: CheckoutAttempt) => a.failureReason) && (
        <Card>
          <h3 className="text-lg font-semibold text-white mb-4">Recent Errors</h3>
          <div className="space-y-3">
            {attempts
              .filter((a: CheckoutAttempt) => a.failureReason)
              .slice(0, 5)
              .map((attempt: CheckoutAttempt) => (
                <div key={attempt.id} className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-400">{formatDate(attempt.startedAt)}</span>
                    <span className="text-xs text-gray-500 font-mono">{attempt.id.slice(0, 8)}</span>
                  </div>
                  <p className="text-red-400 text-sm">{attempt.failureReason}</p>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
