import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Button, StatusBadge, PageLoading } from '@/components/ui';
import {
  useSKUs,
  useStartMonitoring,
  usePauseMonitoring,
  useStopMonitoring,
  useDeleteSKU,
  useEnableAutoCheckout,
  useDisableAutoCheckout,
  useSocket,
  useRealTimeStockUpdates,
  useRealTimeAlerts,
} from '@/hooks';
import { Plus, Play, Pause, StopCircle, Trash2, ExternalLink, ShoppingCart } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SKU } from '@/types';
import { MonitoringStatus } from '@/types';
import { formatDistanceToNow } from 'date-fns';

export function SKUsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSKUs(page, 20);
  const startMonitoring = useStartMonitoring();
  const pauseMonitoring = usePauseMonitoring();
  const stopMonitoring = useStopMonitoring();
  const deleteSKU = useDeleteSKU();
  const enableAutoCheckout = useEnableAutoCheckout();
  const disableAutoCheckout = useDisableAutoCheckout();

  // Connect socket and subscribe to real-time updates
  useSocket();
  useRealTimeStockUpdates();
  useRealTimeAlerts();

  const handleStartMonitoring = (sku: SKU) => {
    startMonitoring.mutate(sku.id, {
      onSuccess: () => toast.success(`Started monitoring ${sku.productName}`),
      onError: () => toast.error('Failed to start monitoring'),
    });
  };

  const handlePauseMonitoring = (sku: SKU) => {
    pauseMonitoring.mutate(sku.id, {
      onSuccess: () => toast.success(`Paused monitoring ${sku.productName}`),
      onError: () => toast.error('Failed to pause monitoring'),
    });
  };

  const handleStopMonitoring = (sku: SKU) => {
    stopMonitoring.mutate(sku.id, {
      onSuccess: () => toast.success(`Stopped monitoring ${sku.productName}`),
      onError: () => toast.error('Failed to stop monitoring'),
    });
  };

  const handleDelete = (sku: SKU) => {
    if (window.confirm(`Are you sure you want to delete ${sku.productName}?`)) {
      deleteSKU.mutate(sku.id, {
        onSuccess: () => toast.success(`Deleted ${sku.productName}`),
        onError: () => toast.error('Failed to delete SKU'),
      });
    }
  };

  const handleToggleAutoCheckout = (sku: SKU) => {
    if (sku.autoCheckoutEnabled) {
      disableAutoCheckout.mutate(sku.id, {
        onSuccess: () => toast.success(`Auto-checkout disabled for ${sku.productName}`),
        onError: () => toast.error('Failed to disable auto-checkout'),
      });
    } else {
      enableAutoCheckout.mutate(sku.id, {
        onSuccess: () => toast.success(`Auto-checkout enabled for ${sku.productName}`),
        onError: () => toast.error('Failed to enable auto-checkout'),
      });
    }
  };

  if (isLoading) {
    return <PageLoading />;
  }

  const skus = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">SKUs</h1>
          <p className="text-gray-400 mt-1">Manage your monitored products</p>
        </div>
        <Link to="/skus/new">
          <Button icon={<Plus className="h-4 w-4" />}>Add SKU</Button>
        </Link>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="table-header">Product</th>
                <th className="table-header">Retailer</th>
                <th className="table-header">Status</th>
                <th className="table-header">Stock</th>
                <th className="table-header">Price</th>
                <th className="table-header">Auto-Buy</th>
                <th className="table-header">Last Checked</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {skus.map((sku) => (
                <tr key={sku.id} className="hover:bg-gray-700/50">
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-white">{sku.productName}</p>
                        <p className="text-sm text-gray-400">{sku.productId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="table-cell">
                    <span className="capitalize text-gray-300">{sku.retailer}</span>
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={sku.monitoringStatus} />
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={sku.currentStockStatus} />
                  </td>
                  <td className="table-cell">
                    <span className="text-white">
                      {sku.currentPrice !== null ? `$${sku.currentPrice.toFixed(2)}` : '-'}
                    </span>
                    {sku.targetPrice !== null && (
                      <span className="text-xs text-gray-400 block">
                        Target: ${sku.targetPrice.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="table-cell">
                    <button
                      onClick={() => handleToggleAutoCheckout(sku)}
                      title={sku.autoCheckoutEnabled ? 'Disable auto-checkout' : 'Enable auto-checkout'}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                        sku.autoCheckoutEnabled
                          ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                      }`}
                    >
                      <ShoppingCart className="h-3 w-3" />
                      {sku.autoCheckoutEnabled ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td className="table-cell">
                    <span className="text-gray-400 text-sm">
                      {sku.lastCheckedAt !== null
                        ? formatDistanceToNow(new Date(sku.lastCheckedAt), { addSuffix: true })
                        : 'Never'}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center justify-end gap-2">
                      {sku.monitoringStatus === MonitoringStatus.STOPPED ? (
                        <button
                          onClick={() => handleStartMonitoring(sku)}
                          className="btn-icon text-success-500 hover:bg-success-500/20"
                          title="Start monitoring"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      ) : sku.monitoringStatus === MonitoringStatus.ACTIVE ? (
                        <button
                          onClick={() => handlePauseMonitoring(sku)}
                          className="btn-icon text-warning-500 hover:bg-warning-500/20"
                          title="Pause monitoring"
                        >
                          <Pause className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStartMonitoring(sku)}
                          className="btn-icon text-success-500 hover:bg-success-500/20"
                          title="Resume monitoring"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleStopMonitoring(sku)}
                        className="btn-icon text-gray-400 hover:bg-gray-700"
                        title="Stop monitoring"
                        disabled={sku.monitoringStatus === MonitoringStatus.STOPPED}
                      >
                        <StopCircle className="h-4 w-4" />
                      </button>
                      <a
                        href={sku.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-icon text-gray-400 hover:bg-gray-700"
                        title="Open product page"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button
                        onClick={() => handleDelete(sku)}
                        className="btn-icon text-danger-500 hover:bg-danger-500/20"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {skus.length === 0 && (
                <tr>
                  <td colSpan={8} className="table-cell text-center text-gray-400">
                    No SKUs found. Add your first product to start monitoring.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pagination !== undefined && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
            <p className="text-sm text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} results
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= pagination.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
