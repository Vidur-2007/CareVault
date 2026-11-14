import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type CardTone = 'default' | 'action' | 'muted' | 'dark';

const TONE: Record<CardTone, string> = {
  default: 'bg-surface border border-line shadow-card',
  action: 'bg-surface border-[1.5px] border-red-line shadow-card',
  muted: 'bg-grey-tint border border-transparent',
  dark: 'bg-teal-dark text-white border border-transparent [&_h2]:text-white [&_h3]:text-white',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  as?: 'div' | 'section' | 'article' | 'li';
  padded?: boolean;
  children: ReactNode;
}

export function Card({ tone = 'default', as: Tag = 'div', padded = true, className, children, ...rest }: CardProps) {
  return (
    <Tag className={cx('rounded-card-sm md:rounded-card', TONE[tone], padded && 'p-[18px] md:p-7', className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Inner panel inside a card (radius 16, muted surface). */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-panel bg-surface-muted p-4 md:p-5', className)} {...rest}>
      {children}
    </div>
  );
}
