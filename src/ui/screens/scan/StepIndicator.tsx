import { Check } from 'lucide-react';
import { cx } from '../../lib/cx';

const SCAN_STEPS = ['Photo', 'Reading', 'Check', 'Done'] as const;

/** Four steps of the scan flow; the current one is marked with aria-current="step". */
export function StepIndicator({ current }: { current: number }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-secondary">
      {SCAN_STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cx(
                'flex size-7 items-center justify-center rounded-full text-min font-bold',
                done ? 'bg-teal text-white' : active ? 'bg-teal-tint text-teal-ink ring-2 ring-teal' : 'bg-grey-tint text-ink-3',
              )}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cx('font-medium', active ? 'text-ink' : 'text-ink-3')}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < SCAN_STEPS.length - 1 && <span aria-hidden className="mx-1 h-px w-5 bg-line-strong/60" />}
          </li>
        );
      })}
    </ol>
  );
}
