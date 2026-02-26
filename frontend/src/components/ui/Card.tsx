import { ReactNode } from 'react';
import clsx from 'clsx';

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function Card({ children, className, title, description, action }: CardProps) {
  return (
    <div className={clsx('card', className)}>
      {(title !== undefined || action !== undefined) && (
        <div className="flex items-center justify-between mb-4">
          <div>
            {title !== undefined && (
              <h3 className="text-lg font-semibold text-white">{title}</h3>
            )}
            {description !== undefined && (
              <p className="text-sm text-gray-400 mt-1">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
