import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { statusBody, statusTitle } from './visitText';

/** Dark panel in the side column (900 px and up). */
export function StatusPanel({ count }: { count: number }) {
  return (
    <section aria-labelledby="status-title" aria-live="polite" className="hidden rounded-card bg-teal-dark p-7 text-white wide:block">
      <h2 id="status-title" className="font-sans text-[22px] font-semibold text-white">
        {statusTitle(count)}
      </h2>
      <p className="mt-3 text-white/90">{statusBody(count)}</p>
      <Link
        to="/visit/passport"
        className="mt-5 flex min-h-14 items-center justify-center rounded-cta bg-white px-6 font-semibold text-teal-dark transition-colors hover:bg-teal-tint"
      >
        Open the Doctor Visit Passport
      </Link>
    </section>
  );
}

/** Under 900 px the status panel becomes a bar fixed above the tab bar (UI spec section 9). */
export function StatusBar({ count }: { count: number }) {
  return (
    <div
      role="region"
      aria-label="Visit status"
      className="fixed inset-x-0 z-20 border-t border-white/10 bg-teal-dark px-5 py-3 text-white shadow-overlay wide:hidden print:hidden bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-0"
    >
      <div className="mx-auto flex max-w-content items-center gap-3">
        <p aria-live="polite" className="min-w-0 flex-1 text-secondary font-semibold">
          {statusTitle(count)}
        </p>
        <Link
          to="/visit/passport"
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-button bg-white px-4 text-secondary font-semibold text-teal-dark"
        >
          Open passport
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </div>
    </div>
  );
}
