import { Link } from 'react-router';
import { formatTime, formatWeekdayDate } from '../../lib/format';
import { passportReadySentence } from './copy';
import type { VisitContext } from './copy';

/** Dark "Next visit" panel in the side column (desktop and tablet; phones use the compact link). */
export function NextVisitPanel({ visit, openCount }: { visit: VisitContext | null; openCount: number | null }) {
  return (
    <section aria-labelledby="next-visit-title" className="rounded-card-sm bg-teal-dark p-6 text-white md:rounded-card md:p-7">
      <p className="text-secondary font-semibold uppercase tracking-[0.08em] text-white/80">Next visit</p>
      {visit ? (
        <>
          <h2 id="next-visit-title" className="mt-3 text-[26px] leading-tight text-white md:text-[28px]">
            {formatWeekdayDate(visit.visit.at)}
          </h2>
          {visit.prescriber && (
            <p className="mt-3 text-white/90">
              {visit.prescriber.name}, {visit.prescriber.specialty.toLowerCase()}
            </p>
          )}
          <p className="text-white/90">{formatTime(visit.visit.at)}</p>
          {openCount !== null && (
            <p className="mt-5 border-t border-white/15 pt-5 text-white/90">{passportReadySentence(openCount)}</p>
          )}
        </>
      ) : (
        <>
          <h2 id="next-visit-title" className="mt-3 text-[24px] leading-tight text-white">
            No visit planned yet
          </h2>
          <p className="mt-3 text-white/90">Add the next appointment to prepare questions and the visit passport.</p>
          <Link to="/visit" className="mt-5 inline-flex min-h-12 items-center font-semibold text-teal-tint underline underline-offset-4">
            Add a visit
          </Link>
        </>
      )}
    </section>
  );
}
