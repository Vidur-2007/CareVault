import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import type { PillSpec, PillTone } from './pills';

const TONE: Record<PillTone, string> = {
  teal: 'bg-teal-tint text-teal-ink',
  blue: 'bg-blue-tint text-blue-ink',
  amber: 'bg-amber-tint text-amber-ink',
  red: 'bg-red-tint text-red-ink',
  grey: 'bg-grey-tint text-grey-ink',
  check: 'border border-amber-ink/60 bg-transparent text-amber-ink',
  outline: 'border border-grey-ink/50 bg-transparent text-grey-ink',
};

export interface PillProps {
  tone?: PillTone;
  children?: ReactNode;
  /** Shorthand for tone + label from the helpers in pills.ts. */
  spec?: PillSpec;
  icon?: ReactNode;
  className?: string;
}

export function Pill({ tone, children, spec, icon, className }: PillProps) {
  const t = spec?.tone ?? tone ?? 'grey';
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-full px-3 py-1 text-pill font-semibold whitespace-nowrap',
        TONE[t],
        className,
      )}
    >
      {icon}
      <span className="truncate">{children ?? spec?.label}</span>
    </span>
  );
}
