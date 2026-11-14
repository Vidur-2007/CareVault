import type { ReactNode } from 'react';

/** Temporary screen body until the screen is built in its phase. */
export function Placeholder({ title, phase, children }: { title: string; phase: number; children?: ReactNode }) {
  return (
    <div className="page-gutter py-8 md:py-12">
      <h1 className="text-page-sm md:text-page">{title}</h1>
      <p className="mt-3 text-ink-3">This screen is built in phase {phase}.</p>
      {children}
    </div>
  );
}
