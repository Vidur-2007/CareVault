import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = `${inputId}-desc`;
  return (
    <div className={cx('flex min-h-12 items-start gap-3 py-2', className)}>
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={description ? descId : undefined}
        className="mt-0.5 size-6 shrink-0 cursor-pointer rounded-[6px] accent-teal"
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={inputId} className="cursor-pointer text-ink-2">
          {label}
        </label>
        {description && (
          <p id={descId} className="text-secondary text-ink-3">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
