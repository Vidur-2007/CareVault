import { cx } from '../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-teal text-white hover:bg-teal-ink',
  secondary: 'border border-teal bg-surface text-teal-ink hover:bg-teal-tint',
  quiet: 'px-1 text-teal underline decoration-2 underline-offset-4 hover:text-teal-ink',
  danger: 'bg-red-ink text-white hover:brightness-110',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  cta?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Class names for a button-looking element (also usable on plain links and labels). */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  cta = false,
  fullWidth = false,
  disabled = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cx(
    'inline-flex items-center justify-center gap-2 text-center font-semibold',
    'transition-[background-color,color,transform,box-shadow] duration-150 motion-safe:active:scale-[0.98]',
    variant === 'quiet'
      ? 'min-h-12 text-body-sm md:text-body'
      : size === 'sm'
        ? 'min-h-11 px-4 text-secondary'
        : 'min-h-12 px-5 text-body-sm md:text-body',
    cta ? 'rounded-cta shadow-cta md:min-h-14 md:px-7' : 'rounded-button',
    VARIANT[variant],
    fullWidth && 'w-full',
    disabled && 'pointer-events-none opacity-60',
    className,
  );
}
