import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center rounded-card-sm border border-dashed border-line-strong/60 bg-surface px-6 py-10 text-center md:rounded-card', className)}>
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-teal-tint text-teal-ink [&_svg]:size-7">{icon}</div>}
      <h3 className="text-card-sm md:text-card">{title}</h3>
      {children && <div className="mt-2 max-w-md text-ink-3">{children}</div>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}
