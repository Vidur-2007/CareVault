import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  label: string;
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
}

/** A radio group drawn as segments. Arrow keys move between options. */
export function SegmentedControl<V extends string>({ label, options, value, onChange, className }: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-button bg-grey-tint p-1', className)}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              'inline-flex min-h-11 items-center gap-2 rounded-[9px] px-4 text-secondary font-semibold transition-colors',
              selected ? 'bg-surface text-teal-ink shadow-card' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
