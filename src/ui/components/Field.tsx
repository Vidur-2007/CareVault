import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import { Pill } from './Pill';
import { CHECK_THIS } from './pills';

interface FieldBase {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Warnings from extraction, shown under the field. */
  warnings?: string[];
  /** Value came from extraction and is not confirmed yet: shows the "Check this" marker. */
  extracted?: boolean;
  className?: string;
}

type InputField = FieldBase & { as?: 'input' } & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;
type TextareaField = FieldBase & { as: 'textarea' } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;
type SelectField = FieldBase & { as: 'select'; options: { value: string; label: string }[] } & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>;

export type FieldProps = InputField | TextareaField | SelectField;

const CONTROL =
  'w-full rounded-button border bg-surface px-4 text-body-sm text-ink placeholder:text-ink-3 md:text-body ' +
  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal/40 focus-visible:border-teal disabled:bg-surface-muted disabled:text-ink-3';

const FIELD_ONLY = ['label', 'hint', 'error', 'warnings', 'extracted', 'className', 'as', 'options'];

/** The props meant for the native control, without the Field's own props. */
function controlProps(props: FieldProps): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  for (const key of FIELD_ONLY) delete out[key];
  return out;
}

/** Label, control, hint and error; errors and hints are linked with aria-describedby. */
export function Field(props: FieldProps) {
  const { label, hint, error, warnings, extracted, className } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const warnId = `${id}-warn`;
  const describedBy = [hint && hintId, warnings?.length && warnId, error && errorId].filter(Boolean).join(' ') || undefined;
  const border = error ? 'border-red-ink' : extracted ? 'border-amber-ink/70 border-[1.5px]' : 'border-line-strong';
  const aria = { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined };

  let control: ReactNode;
  if (props.as === 'textarea') {
    const rest = controlProps(props) as TextareaHTMLAttributes<HTMLTextAreaElement>;
    control = <textarea {...rest} {...aria} className={cx(CONTROL, border, 'min-h-28 py-3')} />;
  } else if (props.as === 'select') {
    const rest = controlProps(props) as SelectHTMLAttributes<HTMLSelectElement>;
    control = (
      <select {...rest} {...aria} className={cx(CONTROL, border, 'min-h-12 py-2')}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    const rest = controlProps(props) as InputHTMLAttributes<HTMLInputElement>;
    control = <input {...rest} {...aria} className={cx(CONTROL, border, 'min-h-12 py-2')} />;
  }

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="font-semibold text-ink">
          {label}
        </label>
        {extracted && <Pill spec={CHECK_THIS} />}
      </div>
      {control}
      {hint && (
        <p id={hintId} className="text-secondary text-ink-3">
          {hint}
        </p>
      )}
      {warnings && warnings.length > 0 && (
        <ul id={warnId} className="text-secondary text-amber-ink">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {error && (
        <p id={errorId} className="text-secondary font-medium text-red-ink">
          {error}
        </p>
      )}
    </div>
  );
}
