import { RotateCcw, TriangleAlert } from 'lucide-react';
import { cx } from '../lib/cx';
import { Button } from './Button';

export interface ErrorPanelProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function ErrorPanel({ title = 'This could not be loaded', message, onRetry, retrying, className }: ErrorPanelProps) {
  return (
    <div role="alert" className={cx('rounded-card-sm border-[1.5px] border-red-line bg-surface p-[18px] md:rounded-card md:p-7', className)}>
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-6 shrink-0 text-red-ink" />
        <div className="min-w-0 flex-1">
          <h3 className="text-card-sm">{title}</h3>
          <p className="mt-1 text-ink-3">{message ?? 'Something went wrong. Your records on this device are not affected.'}</p>
          {onRetry && (
            <Button variant="secondary" className="mt-4" onClick={onRetry} loading={retrying} icon={<RotateCcw aria-hidden className="size-5" />}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
