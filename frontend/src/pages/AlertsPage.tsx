import { useState } from 'react';
import { Card, Button, StatusBadge, Loading } from '@/components/ui';
import { useAlerts, useAcknowledgeAlert } from '@/hooks';
import { Alert, AlertType } from '@/types';
import toast from 'react-hot-toast';

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getAlertTypeLabel = (type: AlertType): string => {
  switch (type) {
    case AlertType.STOCK_AVAILABLE:
      return 'In Stock';
    case AlertType.PRICE_DROP:
      return 'Price Drop';
    case AlertType.PRICE_INCREASE:
      return 'Price Increase';
    case AlertType.CHECKOUT_SUCCESS:
      return 'Checkout Success';
    case AlertType.CHECKOUT_FAILED:
      return 'Checkout Failed';
    case AlertType.ERROR:
      return 'Error';
    default:
      return type;
  }
};

export function AlertsPage() {
  const [filter, setFilter] = useState<'all' | 'unacknowledged'>('all');
  const [typeFilter, setTypeFilter] = useState<AlertType | 'all'>('all');
  const { data: alertsResponse, isLoading, error } = useAlerts({
    acknowledged: filter === 'unacknowledged' ? false : undefined,
    type: typeFilter === 'all' ? undefined : typeFilter,
  });
  const { mutate: acknowledge } = useAcknowledgeAlert();

  const alerts = alertsResponse?.data || [];

  const handleAcknowledge = (alertId: string) => {
    acknowledge(alertId, {
      onSuccess: () => {
        toast.success('Alert acknowledged');
      },
      onError: (err) => {
        toast.error(err.message ?? 'Failed to acknowledge alert');
      },
    });
  };

  if (isLoading) {
    return <Loading size="lg" />;
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">Failed to load alerts: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-gray-400 mt-1">Stock notifications and system events</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="label">Status</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | 'unacknowledged')}
              className="input w-auto"
            >
              <option value="all">All Alerts</option>
              <option value="unacknowledged">Unacknowledged</option>
            </select>
          </div>

          <div>
            <label className="label">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as AlertType | 'all')}
              className="input w-auto"
            >
              <option value="all">All Types</option>
              {Object.values(AlertType).map((type) => (
                <option key={type} value={type}>
                  {getAlertTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Alerts List */}
      <Card className="overflow-hidden p-0">
        {!alerts || alerts.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No alerts found
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {alerts.map((alert: Alert) => (
              <div
                key={alert.id}
                className={`p-4 hover:bg-gray-750 transition-colors ${
                  !alert.acknowledgedAt ? 'bg-gray-750/50' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <StatusBadge
                        status={getAlertTypeLabel(alert.type)}
                      />
                      {!alert.acknowledgedAt && (
                        <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
                          New
                        </span>
                      )}
                      <span className="text-sm text-gray-500">
                        {formatDate(alert.createdAt)}
                      </span>
                    </div>

                    <p className="text-white font-medium">{alert.message}</p>

                    {alert.metadata && Object.keys(alert.metadata).length > 0 && (
                      <div className="mt-2 text-sm text-gray-400 space-y-1">
                        {!!alert.metadata.sku_name && (
                          <p>SKU: {String(alert.metadata.sku_name)}</p>
                        )}
                        {alert.metadata.price !== undefined && (
                          <p>Price: ${Number(alert.metadata.price).toFixed(2)}</p>
                        )}
                        {alert.metadata.previous_price !== undefined && (
                          <p>Previous: ${Number(alert.metadata.previous_price).toFixed(2)}</p>
                        )}
                        {!!alert.metadata.retailer && (
                          <p>Retailer: {String(alert.metadata.retailer)}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="ml-4 flex items-center gap-2">
                    {!alert.acknowledgedAt && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleAcknowledge(alert.id)}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
