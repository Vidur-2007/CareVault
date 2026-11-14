import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SectionHeaderProps {
  title: ReactNode;
  id?: string;
  level?: 2 | 3;
  /** Small text on the right, e.g. '3 open'. */
  aside?: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, id, level = 2, aside, action, description, className }: SectionHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cx('mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <Heading id={id} className={level === 2 ? 'text-section-sm md:text-section' : 'text-card-sm md:text-card'}>
          {title}
        </Heading>
        {description && <p className="mt-1 text-secondary text-ink-3">{description}</p>}
      </div>
      {aside && <span className="text-secondary text-ink-3">{aside}</span>}
      {action}
    </div>
  );
}
