import { Card, StatusBadge, PageLoading } from '@/components/ui';
import { useSKUStatistics, useAlertCounts, useHealthCheck } from '@/hooks';
import { 
  Package, 
  Bell, 
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap
} from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

export function DashboardPage() {
  const { data: skuStats, isLoading: skuLoading } = useSKUStatistics();
  const { data: alertCounts, isLoading: alertLoading } = useAlertCounts();
  const { data: health, isLoading: healthLoading } = useHealthCheck();

  if (skuLoading || alertLoading || healthLoading) {
    return <PageLoading />;
  }

  const stats = [
    {
      name: 'Total SKUs',
      value: skuStats?.total ?? 0,
      icon: Package,
      color: 'text-primary-500',
      href: '/skus',
    },
    {
      name: 'Active Monitoring',
      value: skuStats?.active ?? 0,
      icon: Activity,
      color: 'text-success-500',
      href: '/skus?status=active',
    },
    {
      name: 'In Stock',
      value: skuStats?.inStock ?? 0,
      icon: CheckCircle,
      color: 'text-success-500',
      href: '/skus?stock=in_stock',
    },
    {
      name: 'Pending Alerts',
      value: alertCounts?.pending ?? 0,
      icon: Bell,
      color: 'text-warning-500',
      href: '/alerts?status=pending',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">Overview of your monitoring system</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">System Status:</span>
          <StatusBadge status={health?.status ?? 'unknown'} />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.name} to={stat.href}>
            <Card className="hover:border-gray-600 transition-colors">
              <div className="flex items-center gap-4">
                <div className={clsx('p-3 rounded-lg bg-gray-700', stat.color)}>
                  <stat.icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-gray-400">{stat.name}</p>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="SKU Distribution">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-success-500" />
                <span className="text-gray-300">Active</span>
              </div>
              <span className="font-medium text-white">{skuStats?.active ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-500" />
                <span className="text-gray-300">Paused</span>
              </div>
              <span className="font-medium text-white">{skuStats?.paused ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-gray-500" />
                <span className="text-gray-300">Stopped</span>
              </div>
              <span className="font-medium text-white">{skuStats?.stopped ?? 0}</span>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-gray-700">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary-500" />
                <span className="text-gray-300">Auto-Checkout Enabled</span>
              </div>
              <span className="font-medium text-white">{skuStats?.withAutoCheckout ?? 0}</span>
            </div>
          </div>
        </Card>

        <Card title="Stock Status">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-success-500" />
                <span className="text-gray-300">In Stock</span>
              </div>
              <span className="font-medium text-white">{skuStats?.inStock ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-danger-500" />
                <span className="text-gray-300">Out of Stock</span>
              </div>
              <span className="font-medium text-white">{skuStats?.outOfStock ?? 0}</span>
            </div>
            {skuStats !== undefined && skuStats.total > 0 && (
              <div className="pt-4 border-t border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">In Stock Rate</span>
                  <span className="text-sm font-medium text-white">
                    {((skuStats.inStock / skuStats.total) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-success-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(skuStats.inStock / skuStats.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Alert Summary */}
      <Card 
        title="Alert Summary" 
        action={
          <Link to="/alerts" className="text-sm text-primary-500 hover:text-primary-400">
            View all
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="text-center p-4 bg-gray-700/50 rounded-lg">
            <p className="text-2xl font-bold text-white">{alertCounts?.total ?? 0}</p>
            <p className="text-sm text-gray-400">Total</p>
          </div>
          <div className="text-center p-4 bg-gray-700/50 rounded-lg">
            <p className="text-2xl font-bold text-warning-500">{alertCounts?.pending ?? 0}</p>
            <p className="text-sm text-gray-400">Pending</p>
          </div>
          <div className="text-center p-4 bg-gray-700/50 rounded-lg">
            <p className="text-2xl font-bold text-success-500">{alertCounts?.acknowledged ?? 0}</p>
            <p className="text-sm text-gray-400">Acknowledged</p>
          </div>
          <div className="text-center p-4 bg-gray-700/50 rounded-lg">
            <p className="text-2xl font-bold text-primary-500">
              {alertCounts?.byType?.STOCK_AVAILABLE ?? 0}
            </p>
            <p className="text-sm text-gray-400">Stock Available</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
