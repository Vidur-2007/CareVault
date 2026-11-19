import { useCountUp } from '../app/motion';
import { cx } from '../lib/cx';

export type StatTone = 'teal' | 'blue' | 'amber' | 'red' | 'grey';

const TONE: Record<StatTone, string> = {
  teal: 'bg-teal-tint text-teal-ink',
  blue: 'bg-blue-tint text-blue-ink',
  amber: 'bg-amber-tint text-amber-ink',
  red: 'bg-red-tint text-red-ink',
  grey: 'bg-grey-tint text-grey-ink',
};

export interface StatTileProps {
  value: number;
  label: string;
  tone?: StatTone;
  size?: 'md' | 'lg';
  className?: string;
}

export function StatTile({ value, label, tone = 'grey', size = 'md', className }: StatTileProps) {
  const shown = useCountUp(value);
  return (
    <div className={cx('rounded-panel p-4 md:p-5', size === 'lg' && 'md:rounded-card-sm md:p-6', TONE[tone], className)}>
      {/* The final value is announced; the counting digits are hidden from screen readers. */}
      <p className="sr-only">
        {value} {label}
      </p>
      <p aria-hidden className={cx('font-heading font-bold tabular-nums', size === 'lg' ? 'text-[32px] leading-tight' : 'text-[28px] leading-tight')}>
        {shown}
      </p>
      <p aria-hidden className="mt-1 text-secondary font-medium md:text-body-sm">
        {label}
      </p>
    </div>
  );
}
