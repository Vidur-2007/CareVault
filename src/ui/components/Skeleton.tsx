import { cx } from '../lib/cx';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-skeleton rounded-[8px] bg-grey-tint', className ?? 'h-4 w-full')} />;
}

/** A card-shaped placeholder: title line plus body lines. */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cx('rounded-card-sm border border-line bg-surface p-[18px] md:rounded-card md:p-7', className)}>
      <Skeleton className="mb-4 h-6 w-32 rounded-full" />
      <Skeleton className="mb-3 h-6 w-3/4" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('mb-2 h-4', i === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  );
}

/** Loading region: announced once to screen readers, visual skeletons hidden from them. */
export function SkeletonList({ count = 3, lines = 2, label = 'Loading' }: { count?: number; lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}
