import { LoaderCircle } from 'lucide-react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { buttonClasses } from './buttonStyles';
import type { ButtonVariant } from './buttonStyles';

interface CommonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Primary call-to-action: larger radius and its own shadow. */
  cta?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>;
type NativeAnchor = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'>;

export type ButtonProps = CommonProps & NativeButton & { to?: undefined };
export type ButtonLinkProps = CommonProps & NativeAnchor & { to: string };

/** A real <button>, or a router link styled as a button when `to` is given. */
export function Button(props: ButtonProps | ButtonLinkProps) {
  const { variant, size, cta, loading = false, icon, fullWidth, className, children, ...rest } = props;
  const content = (
    <>
      {loading ? <LoaderCircle aria-hidden className="size-5 animate-spin" /> : icon}
      <span>{children}</span>
    </>
  );

  if (rest.to !== undefined) {
    const { to, ...anchor } = rest as NativeAnchor & { to: string };
    return (
      <Link to={to} className={buttonClasses({ variant, size, cta, fullWidth, className })} {...anchor}>
        {content}
      </Link>
    );
  }

  const { disabled, type, ...native } = rest as NativeButton & { to?: undefined };
  delete native.to;
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, cta, fullWidth, disabled: disabled || loading, className })}
      {...native}
    >
      {content}
    </button>
  );
}
