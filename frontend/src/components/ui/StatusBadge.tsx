import clsx from 'clsx';
import { MonitoringStatus, StockStatus, CheckoutStatus, AlertStatus } from '@/types';

type StatusType = MonitoringStatus | StockStatus | CheckoutStatus | AlertStatus | string;

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

const statusStyles: Record<string, string> = {
  // Monitoring Status
  ACTIVE: 'status-active',
  PAUSED: 'status-paused',
  STOPPED: 'status-stopped',
  ERROR: 'status-out-of-stock',
  COOLDOWN: 'bg-warning-500/20 text-warning-500',

  // Stock Status
  IN_STOCK: 'status-in-stock',
  OUT_OF_STOCK: 'status-out-of-stock',
  LOW_STOCK: 'bg-warning-500/20 text-warning-500',
  LIMITED: 'bg-warning-500/20 text-warning-500',
  PREORDER: 'bg-primary-500/20 text-primary-500',
  BACKORDER: 'bg-warning-500/20 text-warning-500',
  UNKNOWN: 'bg-gray-500/20 text-gray-400',

  // Checkout Status
  IDLE: 'bg-gray-500/20 text-gray-400',
  INITIATED: 'bg-primary-500/20 text-primary-500',
  PROCESSING: 'bg-warning-500/20 text-warning-500',
  COMPLETED: 'status-active',
  SUCCESS: 'status-active',
  FAILED: 'status-out-of-stock',
  CANCELLED: 'status-stopped',
  TIMEOUT: 'status-out-of-stock',

  // Alert Status
  PENDING: 'bg-warning-500/20 text-warning-500',
  ACKNOWLEDGED: 'bg-gray-500/20 text-gray-400',
};

const statusLabels: Record<string, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  STOPPED: 'Stopped',
  ERROR: 'Error',
  COOLDOWN: 'Cooldown',
  IN_STOCK: 'In Stock',
  OUT_OF_STOCK: 'Out of Stock',
  LOW_STOCK: 'Low Stock',
  LIMITED: 'Limited',
  PREORDER: 'Pre-order',
  BACKORDER: 'Backorder',
  UNKNOWN: 'Unknown',
  IDLE: 'Idle',
  INITIATED: 'Initiated',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  TIMEOUT: 'Timeout',
  PENDING: 'Pending',
  ACKNOWLEDGED: 'Acknowledged',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = statusStyles[status] ?? 'bg-gray-500/20 text-gray-400';
  const label = statusLabels[status] ?? status;

  return (
    <span className={clsx('status-badge', style, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
