import type { ReactNode } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Temporary body for a v2 route until its screen is built in its step (UI spec section 6). */
export function Placeholder({ title, step, children }: { title: string; step: number; children?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="page-gutter py-8 md:py-12">
      <h1 className="text-page-sm md:text-page">{title}</h1>
      <p className="mt-3 text-ink-3">This screen is built in step {step}.</p>
      {children}
    </div>
  );
}
